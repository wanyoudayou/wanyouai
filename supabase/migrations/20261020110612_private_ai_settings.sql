begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Immutable connection versions let an active index retain its own model/key during a rebuild.
create table public.ai_connections (
 id uuid primary key default gen_random_uuid(),
 purpose text not null check(purpose in ('generation','embedding')),
 protocol text not null check(protocol in ('chat','responses','messages','embeddings')),
 base_url text not null,
 model text not null check(model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
 api_key text not null check(length(api_key) between 10 and 1024 and api_key ~ '^[!-~]+$'),
 verified_at timestamptz,
 probe_summary jsonb,
 created_at timestamptz not null default now(),
 constraint ai_connection_target check (
  (purpose='embedding' and protocol='embeddings' and base_url='https://api.siliconflow.cn/v1' and model='BAAI/bge-m3') or
  (purpose='generation' and (
   (base_url in ('https://api.openai.com/v1','https://api.deepseek.com') and protocol in ('chat','responses')) or
   (base_url='https://api.siliconflow.cn/v1' and protocol='chat') or
   (base_url='https://api.anthropic.com/v1' and protocol='messages'))))
);
create table public.ai_settings (
 id integer primary key check(id=1),
 revision uuid not null default gen_random_uuid(),
 generation_connection uuid references public.ai_connections(id),
 embedding_connection uuid references public.ai_connections(id),
 embedding_key_shared boolean not null default false,
 avatar_enabled boolean not null default false,
 anonymous_entry boolean not null default false,
 owner_instructions text not null default '用简体中文简洁回答本站内容、服务与使用问题；资料不足时说明缺少什么，并引导访客查看相关内容或联系站主。' check(length(owner_instructions)<=8000),
 monthly_limit integer check(monthly_limit between 0 and 1000000),
 updated_at timestamptz not null default now()
);
insert into public.ai_settings(id) values(1);
create table public.ai_calls (
 request_id uuid primary key,
 task text not null check(task in ('avatar','page','generation_probe','embedding_probe','retrieval')),
 connection_id uuid not null references public.ai_connections(id),
 user_id uuid references auth.users(id) on delete set null,
 ip text check(length(ip)<=128),
 state text not null check(state in ('reserved','dispatched','succeeded','unknown','released')),
 tokens_in integer not null default 0 check(tokens_in>=0),
 tokens_out integer not null default 0 check(tokens_out>=0),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index ai_calls_subject_time on public.ai_calls(user_id,created_at);
create index ai_calls_ip_time on public.ai_calls(ip,created_at) where user_id is null;
create index ai_calls_time_task on public.ai_calls(created_at,task);

-- No browser role, including an owner JWT, can directly access credentials or call accounting.
alter table public.ai_connections enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_calls enable row level security;
revoke all on public.ai_connections,public.ai_settings,public.ai_calls from public,anon,authenticated;
grant select,insert,update,delete on public.ai_connections,public.ai_settings,public.ai_calls to service_role;

create function public.guard_ai_connection_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.purpose,new.protocol,new.base_url,new.model,new.api_key,new.created_at)
  is distinct from (old.id,old.purpose,old.protocol,old.base_url,old.model,old.api_key,old.created_at) then
  raise exception 'AI_CONNECTION_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger ai_connection_version before update on public.ai_connections
 for each row execute function public.guard_ai_connection_version();
revoke all on function public.guard_ai_connection_version() from public,anon,authenticated,service_role;

create function public.ai_save_connection(p_previous uuid,p_definition jsonb,p_key text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare previous public.ai_connections; result_id uuid; candidate_key text;
begin
 if p_definition is null or p_key is null or jsonb_typeof(p_definition)<>'object'
  or p_definition - array['purpose','protocol','baseUrl','model'] <> '{}'::jsonb
  or not(p_definition ?& array['purpose','protocol','baseUrl','model']) then raise exception 'INVALID_AI_CONNECTION'; end if;
 if coalesce(p_definition->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
  or not ((p_definition->>'purpose'='embedding' and p_definition->>'protocol'='embeddings' and p_definition->>'baseUrl'='https://api.siliconflow.cn/v1' and p_definition->>'model'='BAAI/bge-m3')
   or (p_definition->>'purpose'='generation' and (
    (p_definition->>'baseUrl' in ('https://api.openai.com/v1','https://api.deepseek.com') and p_definition->>'protocol' in ('chat','responses'))
    or (p_definition->>'baseUrl'='https://api.siliconflow.cn/v1' and p_definition->>'protocol'='chat')
    or (p_definition->>'baseUrl'='https://api.anthropic.com/v1' and p_definition->>'protocol'='messages')))) then raise exception 'INVALID_AI_CONNECTION'; end if;
 if p_previous is not null then select * into previous from public.ai_connections where id=p_previous; end if;
 candidate_key:=nullif(p_key,'');
 if candidate_key is null then
  if previous.id is null or previous.base_url is distinct from p_definition->>'baseUrl'
   or previous.purpose is distinct from p_definition->>'purpose' then raise exception 'AI_TARGET_KEY_REQUIRED'; end if;
  candidate_key:=previous.api_key;
 end if;
 if length(candidate_key) not between 10 and 1024 or candidate_key !~ '^[!-~]+$' then raise exception 'INVALID_AI_KEY'; end if;
 if previous.id is not null and previous.purpose=p_definition->>'purpose'
  and previous.protocol=p_definition->>'protocol' and previous.base_url=p_definition->>'baseUrl'
  and previous.model=p_definition->>'model' and previous.api_key=candidate_key then return previous.id; end if;
 insert into public.ai_connections(purpose,protocol,base_url,model,api_key)
 values(p_definition->>'purpose',p_definition->>'protocol',p_definition->>'baseUrl',p_definition->>'model',candidate_key)
 returning id into result_id;
 return result_id;
end $$;

create function public.save_ai_settings(p_owner uuid,p_expected uuid,p_generation jsonb,p_generation_key text,
 p_embedding jsonb,p_embedding_key text,p_reuse_key boolean,p_avatar jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_config public.ai_settings; generation_id uuid; embedding_id uuid; generation public.ai_connections;
 enabled boolean; anonymous_enabled boolean; instructions text; monthly integer;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select * into current_config from public.ai_settings where id=1 for update;
 if not found or current_config.revision is distinct from p_expected then raise exception 'SETTINGS_CONFLICT'; end if;
 if p_reuse_key is null or p_generation_key is null or p_embedding_key is null or p_avatar is null
  or jsonb_typeof(p_avatar)<>'object' or p_avatar - array['enabled','anonymousEntry','instructions','monthlyLimit'] <> '{}'::jsonb
  or not(p_avatar ?& array['enabled','anonymousEntry','instructions','monthlyLimit'])
  or jsonb_typeof(p_avatar->'enabled')<>'boolean' or jsonb_typeof(p_avatar->'anonymousEntry')<>'boolean'
  or jsonb_typeof(p_avatar->'instructions')<>'string'
  or jsonb_typeof(p_avatar->'monthlyLimit') not in ('number','null') then raise exception 'INVALID_AI_SETTINGS'; end if;
 enabled:=(p_avatar->>'enabled')::boolean; anonymous_enabled:=(p_avatar->>'anonymousEntry')::boolean;
 instructions:=p_avatar->>'instructions'; monthly:=(p_avatar->>'monthlyLimit')::integer;
 if p_generation is not null then
  if p_generation->>'purpose' is distinct from 'generation' then raise exception 'INVALID_AI_CONNECTION'; end if;
  generation_id:=public.ai_save_connection(current_config.generation_connection,p_generation,p_generation_key);
  select * into generation from public.ai_connections where id=generation_id;
 elsif p_generation_key<>'' then raise exception 'INVALID_AI_CONNECTION'; end if;
 if p_embedding is not null then
  if p_embedding->>'purpose' is distinct from 'embedding' then raise exception 'INVALID_AI_CONNECTION'; end if;
  if p_reuse_key then
   if generation.id is null or generation.base_url is distinct from p_embedding->>'baseUrl' or p_embedding_key<>'' then raise exception 'AI_SHARED_KEY_TARGET_MISMATCH'; end if;
   embedding_id:=public.ai_save_connection(current_config.embedding_connection,p_embedding,generation.api_key);
  else embedding_id:=public.ai_save_connection(current_config.embedding_connection,p_embedding,p_embedding_key);
  end if;
 elsif p_reuse_key or p_embedding_key<>'' then raise exception 'INVALID_AI_CONNECTION'; end if;
 update public.ai_settings set generation_connection=generation_id,embedding_connection=embedding_id,
  embedding_key_shared=p_reuse_key,avatar_enabled=enabled,anonymous_entry=anonymous_enabled,
  owner_instructions=instructions,monthly_limit=monthly,revision=gen_random_uuid(),updated_at=clock_timestamp() where id=1;
 -- The index readiness trigger updates the public availability projection.
 return jsonb_build_object('revision',(select revision from public.ai_settings where id=1));
end $$;

create function public.reserve_ai_call(p_request uuid,p_task text,p_connection uuid,p_user uuid,p_ip text)
returns text language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; old_call public.ai_calls; owner_user boolean; cap integer; v_now timestamptz; start_day timestamptz;
begin
 if p_request is null or p_task is null or p_task not in ('avatar','page','generation_probe','embedding_probe','retrieval')
  or p_connection is null or length(coalesce(p_ip,''))>128 or (p_user is null and nullif(p_ip,'') is null) then raise exception 'INVALID_AI_CALL'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'AI_BUDGET_REQUIRES_READ_COMMITTED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-call-budget',0));
 v_now:=clock_timestamp();start_day:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 select * into old_call from public.ai_calls where request_id=p_request;
 if found then
  if old_call.task is distinct from p_task or old_call.connection_id is distinct from p_connection
   or old_call.user_id is distinct from p_user or old_call.ip is distinct from p_ip then raise exception 'AI_CALL_MISMATCH'; end if;
  return 'duplicate';
 end if;
 select * into cfg from public.ai_settings where id=1;
 if p_user is not null then
  select is_owner into owner_user from public.profiles where id=p_user;
  if not found then raise exception 'INVALID_AI_PRINCIPAL'; end if;
 else owner_user:=false; end if;
 if p_task in ('page','generation_probe','embedding_probe') and not owner_user then raise exception 'OWNER_REQUIRED'; end if;
 if p_task in ('avatar','retrieval') and (not cfg.avatar_enabled or
  not exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true') or (p_user is null and not cfg.anonymous_entry)) then return 'disabled'; end if;
 if p_task in ('page','avatar','generation_probe') and p_connection is distinct from cfg.generation_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task='embedding_probe' and p_connection is distinct from cfg.embedding_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task not in ('generation_probe','embedding_probe') and not exists(select 1 from public.ai_connections where id=p_connection and verified_at is not null) then return 'unverified'; end if;
 cap:=case when p_task in ('generation_probe','embedding_probe') then 20 when p_task='page' then 60
  when p_task='retrieval' then case when p_user is null then 15 else 300 end
  when p_user is null then 5
  when exists(select 1 from public.entitlements where user_id=p_user and revoked_at is null and type='subscription'
    and starts_at<=v_now and (ends_at is null or ends_at>v_now)) then 100 else 20 end;
 if (not owner_user or p_task<>'avatar') and ((select count(*) from public.ai_calls where created_at>=start_day and task=p_task
   and state<>'released' and (state<>'reserved' or expires_at>v_now)
   and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) +
   case when p_task='avatar' then (select count(*) from public.avatar_usage where created_at>=start_day and generation_state<>'released'
    and (generation_state<>'reserved' or reservation_expires_at>v_now)
    and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) else 0 end)>=cap then return 'daily_limit'; end if;
 if (select count(*) from public.ai_calls where created_at>v_now-interval '1 minute' and task=p_task
   and state<>'released' and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end)>=5 then return 'rate_limit'; end if;
 if p_task in ('avatar','page') and cfg.monthly_limit is not null and (
  (select count(*) from public.ai_calls where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and task in ('avatar','page') and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now)))>=cfg.monthly_limit then return 'monthly_limit'; end if;
 insert into public.ai_calls(request_id,task,connection_id,user_id,ip,state,expires_at,created_at)
 values(p_request,p_task,p_connection,p_user,p_ip,'reserved',v_now+interval '60 seconds',v_now);
 return 'reserved';
end $$;
create function public.dispatch_ai_call(p_request uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 update public.ai_calls set state='dispatched' where request_id=p_request and state='reserved' and expires_at>clock_timestamp()
  and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'
  and exists(select 1 from public.ai_settings s where s.id=1 and
   case when task in ('avatar','page','generation_probe') then s.generation_connection=connection_id
    when task='embedding_probe' then s.embedding_connection=connection_id else true end
   and (task not in ('avatar','retrieval') or (s.avatar_enabled and (user_id is not null or s.anonymous_entry)
    and exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true'))))
  returning request_id into changed;
 return changed is not null;
end $$;
create function public.finish_ai_call(p_request uuid,p_outcome text,p_tokens_in integer default 0,p_tokens_out integer default 0) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 if p_outcome is null or p_outcome not in ('succeeded','unknown','released') or p_tokens_in is null or p_tokens_out is null
  or p_tokens_in<0 or p_tokens_out<0 then raise exception 'INVALID_AI_OUTCOME'; end if;
 update public.ai_calls set state=p_outcome,tokens_in=p_tokens_in,tokens_out=p_tokens_out where request_id=p_request
  and ((state='reserved' and p_outcome='released') or (state='dispatched' and p_outcome in ('succeeded','unknown')))
  returning request_id into changed;
 return changed is not null;
end $$;
revoke all on function public.ai_save_connection(uuid,jsonb,text),public.save_ai_settings(uuid,uuid,jsonb,text,jsonb,text,boolean,jsonb),
 public.reserve_ai_call(uuid,text,uuid,uuid,text),public.dispatch_ai_call(uuid),public.finish_ai_call(uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.ai_save_connection(uuid,jsonb,text),public.save_ai_settings(uuid,uuid,jsonb,text,jsonb,text,boolean,jsonb),
 public.reserve_ai_call(uuid,text,uuid,uuid,text),public.dispatch_ai_call(uuid),public.finish_ai_call(uuid,text,integer,integer) to service_role;

-- Self-only aggregate; clients cannot read the private call ledger or choose another user.
create function public.avatar_usage_today() returns bigint
language plpgsql stable security definer set search_path='' as $$
declare principal uuid:=auth.uid(); v_now timestamptz:=now(); day_start timestamptz;
begin
 if principal is null then raise exception 'AUTH_REQUIRED'; end if;
 day_start:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 return (select count(*) from public.ai_calls where user_id=principal and task='avatar' and created_at>=day_start
  and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where user_id=principal and created_at>=day_start
   and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now));
end $$;
revoke all on function public.avatar_usage_today() from public,anon,authenticated,service_role;
grant execute on function public.avatar_usage_today() to authenticated;

-- The owner sees aggregate usage, never credentials or other users' call rows.
create or replace function public.admin_dashboard_card(p_section text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare month_start timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 if p_section='revenue' then return jsonb_build_object('revenueThisMonth',(select coalesce(sum(amount),0) from public.orders where status in ('paid','fulfilled') and updated_at>=month_start));
 elsif p_section='subscriptions' then return jsonb_build_object('activeSubscriptions',(select count(distinct user_id) from public.entitlements where type='subscription' and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())));
 elsif p_section='content' then return jsonb_build_object('seriesPublished',(select count(*) from public.series where status='published'),'articlesPublished',(select count(*) from public.articles where status='published'));
 elsif p_section='avatar' then return jsonb_build_object(
  'avatarGenerationsThisMonth',
   (select count(*) from public.avatar_usage where created_at>=month_start and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>now())) +
   (select count(*) from public.ai_calls where task='avatar' and created_at>=month_start and state<>'released' and (state<>'reserved' or expires_at>now())),
  'avatarGenerationsTotal',
   (select count(*) from public.avatar_usage where generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>now())) +
   (select count(*) from public.ai_calls where task='avatar' and state<>'released' and (state<>'reserved' or expires_at>now())),
  'avatarCacheHitsTotal',(select coalesce(sum(hit_count),0) from public.avatar_cache));
 else raise exception 'INVALID_METRIC'; end if;
end $$;
revoke all on function public.admin_dashboard_card(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_dashboard_card(text) to authenticated;
update public.app_schema_version set version='20261020110612',applied_at=now() where id=1;
notify pgrst,'reload schema';
commit;
