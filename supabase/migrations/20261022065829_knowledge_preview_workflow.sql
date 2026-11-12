begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.knowledge_evaluations drop constraint knowledge_evaluations_cases_check;
alter table public.knowledge_evaluations add constraint knowledge_evaluations_cases_check check(jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 20 and 100);
alter table public.knowledge_evaluations add column policy_version integer not null default 1 check(policy_version in (1,2));
alter table public.knowledge_evaluations add column fixed_threshold double precision check(fixed_threshold between -1 and 1);
alter table public.knowledge_evaluations add column regression_from uuid references public.knowledge_evaluations(id) on delete set null;
alter table public.knowledge_index_generations add column accepted_run uuid references public.knowledge_evaluations(id) on delete set null;
alter table public.knowledge_index_generations add column accepted_by uuid references auth.users(id);
alter table public.knowledge_index_generations add column accepted_at timestamptz;
alter table public.knowledge_index_generations add column accepted_policy_version integer check(accepted_policy_version=2);
alter table public.ai_calls drop constraint ai_calls_task_check;
alter table public.ai_calls add constraint ai_calls_task_check check(task in ('avatar','page','generation_probe','embedding_probe','retrieval','knowledge_questions','knowledge_preview','knowledge_preview_retrieval'));

create table public.knowledge_question_drafts (
 id uuid primary key,
 generation_id uuid not null references public.knowledge_index_generations(id) on delete cascade,
 source_revision bigint not null,
 connection_id uuid not null references public.ai_connections(id),
 state text not null default 'pending' check(state in ('pending','leased','failed','complete')),
 manifest jsonb not null check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 10),
 next_item integer not null default 0 check(next_item between 0 and 10),
 cases jsonb not null default '[]' check(jsonb_typeof(cases)='array' and octet_length(cases::text)<=100000),
 lease_id uuid,
 lease_expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(generation_id,source_revision,connection_id),
 check((state='leased')=(lease_id is not null and lease_expires_at is not null))
);
create index knowledge_question_drafts_generation on public.knowledge_question_drafts(generation_id,created_at desc,id);
alter table public.knowledge_question_drafts enable row level security;
revoke all on public.knowledge_question_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.knowledge_question_drafts to service_role;

create or replace function public.reserve_ai_call(p_request uuid,p_task text,p_connection uuid,p_user uuid,p_ip text)
returns text language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; old_call public.ai_calls; owner_user boolean; cap integer; v_now timestamptz; start_day timestamptz;
begin
 if p_request is null or p_task is null or p_task not in ('avatar','page','generation_probe','embedding_probe','retrieval','knowledge_questions','knowledge_preview','knowledge_preview_retrieval')
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
 if p_task in ('page','generation_probe','embedding_probe','knowledge_questions','knowledge_preview','knowledge_preview_retrieval') and not owner_user then raise exception 'OWNER_REQUIRED'; end if;
 if p_task in ('avatar','retrieval') and (not cfg.avatar_enabled or
  not exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true') or (p_user is null and not cfg.anonymous_entry)) then return 'disabled'; end if;
 if p_task in ('page','avatar','generation_probe','knowledge_questions','knowledge_preview') and p_connection is distinct from cfg.generation_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task in ('embedding_probe','knowledge_preview_retrieval') and p_connection is distinct from cfg.embedding_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task not in ('generation_probe','embedding_probe') and not exists(select 1 from public.ai_connections where id=p_connection and verified_at is not null) then return 'unverified'; end if;
 cap:=case when p_task in ('generation_probe','embedding_probe') then 20 when p_task in ('page','knowledge_questions','knowledge_preview','knowledge_preview_retrieval') then 60
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
 if p_task in ('avatar','page','knowledge_questions','knowledge_preview') and cfg.monthly_limit is not null and (
  (select count(*) from public.ai_calls where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and task in ('avatar','page','knowledge_questions','knowledge_preview') and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now)))>=cfg.monthly_limit then return 'monthly_limit'; end if;
 insert into public.ai_calls(request_id,task,connection_id,user_id,ip,state,expires_at,created_at)
 values(p_request,p_task,p_connection,p_user,p_ip,'reserved',v_now+interval '60 seconds',v_now);
 return 'reserved';
end $$;

create or replace function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 20 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if not public.knowledge_evaluation_sources_valid(array(select distinct jsonb_array_elements_text(value->'expected') from jsonb_array_elements(p_cases))) then raise exception 'KNOWLEDGE_EVALUATION_SOURCE_MISSING'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases,policy_version,fixed_threshold,regression_from)
 select p_generation,epoch,case_digest,p_cases,2,
  case when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing and b.accepted_policy_version=2
    and b.accepted_run=r.id and (select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(r.cases) with ordinality)=(select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(p_cases) with ordinality) then b.threshold end,
  case when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing and b.accepted_policy_version=2
    and b.accepted_run=r.id and (select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(r.cases) with ordinality)=(select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(p_cases) with ordinality) then r.id end
 from public.knowledge_index_generations g left join public.knowledge_index_generations b on b.id=g.base_generation
 left join public.knowledge_evaluations r on r.id=b.accepted_run where g.id=p_generation
  on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

create or replace function public.confirm_knowledge_evaluation(p_generation uuid,p_revision bigint,p_threshold double precision,p_evaluation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare run public.knowledge_evaluations; positives integer; negatives integer;
begin
 perform 1 from public.knowledge_index_control where id=1 and source_revision=p_revision for update;
 if not found then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if not exists(select 1 from public.knowledge_index_generations where id=p_generation and scan_complete and approved_revision=p_revision and state in ('building','ready'))
  or exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 select * into run from public.knowledge_evaluations where generation_id=p_generation and source_revision=p_revision
  and digest=p_evaluation->>'digest' and state='complete';
 if not found or jsonb_array_length(run.results)<>jsonb_array_length(run.cases) then raise exception 'KNOWLEDGE_EVALUATION_INCOMPLETE'; end if;
 select count(*) filter(where jsonb_array_length(value->'expected')>0),count(*) filter(where jsonb_array_length(value->'expected')=0)
 into positives,negatives from jsonb_array_elements(run.cases);
 if p_threshold is null or p_threshold not between -1 and 1 or p_evaluation->>'passed' is distinct from 'true'
  or p_evaluation->>'policyVersion' is distinct from '2' or positives<10 or negatives<10
  or (p_evaluation->>'positiveCases')::integer is distinct from positives or (p_evaluation->>'negativeCases')::integer is distinct from negatives
  or coalesce((p_evaluation->>'hits')::integer,0)<ceil(positives*.8) or (p_evaluation->>'hits')::integer>positives
  or coalesce((p_evaluation->>'recall')::numeric,0)<.8
  or abs((p_evaluation->>'recall')::numeric-(p_evaluation->>'hits')::numeric/positives)>0.000000001
  or coalesce((p_evaluation->>'falsePositives')::integer,-1) not between 0 and negatives
 then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 update public.knowledge_index_generations set state='ready',threshold=p_threshold,evaluation=p_evaluation,evaluated_revision=p_revision,
  accepted_at=case when accepted_run=run.id then accepted_at end,
  accepted_policy_version=case when accepted_run=run.id then accepted_policy_version end,
  accepted_by=case when accepted_run=run.id then accepted_by end,
  accepted_run=case when accepted_run=run.id then accepted_run end where id=p_generation;
 return true;
end $$;

create function public.accept_knowledge_preview(p_owner uuid,p_run uuid,p_accept_warnings boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare run public.knowledge_evaluations; g public.knowledge_index_generations; epoch bigint;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into run from public.knowledge_evaluations where id=p_run and state='complete' and source_revision=epoch;
 if not found then raise exception 'KNOWLEDGE_EVALUATION_INCOMPLETE'; end if;
 select * into g from public.knowledge_index_generations where id=run.generation_id for update;
 if not found or g.state<>'ready' or g.evaluated_revision is distinct from epoch or g.evaluation->>'digest' is distinct from run.digest
  or g.evaluation->>'policyVersion' is distinct from '2' or p_accept_warnings is distinct from true then raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end if;
 update public.knowledge_index_generations set accepted_run=run.id,accepted_by=p_owner,accepted_at=clock_timestamp(),accepted_policy_version=2 where id=g.id;
 return true;
end $$;
revoke all on function public.accept_knowledge_preview(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.accept_knowledge_preview(uuid,uuid,boolean) to service_role;

create or replace function public.activate_knowledge_index(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'ready' or generation.accepted_at is null or generation.accepted_by is distinct from p_owner or generation.accepted_run is null or generation.evaluated_revision is distinct from epoch or not generation.scan_complete then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 if not exists(select 1 from public.ai_settings where id=1 and embedding_connection=generation.connection_id)
  or not exists(select 1 from public.ai_connections where id=generation.connection_id and verified_at is not null) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 update public.knowledge_index_generations set state='retired' where state='active';
 update public.knowledge_index_generations set state='active' where id=p_generation;
 update public.knowledge_index_control set active_generation=p_generation where id=1;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create or replace function public.knowledge_index_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 with sources as materialized(select source_key,source_hash,octet_length(content) bytes from public.knowledge_sources),
 history as(select * from public.knowledge_index_generations order by (state in ('active','building','ready')) desc,created_at desc,id limit 20)
 select jsonb_build_object(
  'sourceRevision',(select source_revision from public.knowledge_index_control where id=1),
  'selectedConnection',(select embedding_connection from public.ai_settings where id=1),
  'activeGeneration',(select active_generation from public.knowledge_index_control where id=1),
  'sourceCount',(select count(*) from sources),'sourceBytes',coalesce((select sum(bytes) from sources),0),
  'generationCount',(select count(*) from public.knowledge_index_generations),
  'evaluations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'generationId',r.generation_id,'sourceRevision',r.source_revision,
    'state',case when r.state='leased' and r.lease_expires_at<=clock_timestamp() then 'failed' else r.state end,
    'completed',r.next_case,'total',jsonb_array_length(r.cases),'attempts',r.attempts))
    from public.knowledge_evaluations r where r.generation_id in (select id from history)),'[]'::jsonb),
  'generations',coalesce((select jsonb_agg(jsonb_build_object(
   'mode',g.mode,'baseGeneration',g.base_generation,'reusedItems',(select count(*) from public.knowledge_index_items i join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id and i.reused and i.state='ready'),'id',g.id,'connectionId',g.connection_id,'state',g.state,'scanCursor',g.scan_cursor,'scanComplete',g.scan_complete,
   'approvedRevision',g.approved_revision,'providerAttempts',g.provider_attempts,'threshold',g.threshold,
   'acceptedRun',g.accepted_run,'evaluation',g.evaluation,'evaluatedRevision',g.evaluated_revision,
   'counts',(select jsonb_build_object(
    'total',count(*) filter(where s.source_key is not null),
    'ready',count(*) filter(where s.source_key is not null and i.state='ready'),
    'pending',count(*) filter(where s.source_key is not null and i.state='pending'),
    'leased',count(*) filter(where s.source_key is not null and i.state='leased' and i.lease_expires_at>clock_timestamp()),
    'failed',count(*) filter(where s.source_key is not null and (i.state='failed' or (i.state='leased' and i.lease_expires_at<=clock_timestamp()))),
    'obsolete',count(*) filter(where s.source_key is null or i.state='obsolete'))
    from public.knowledge_index_items i left join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id)
  ) order by g.created_at desc,g.id) from history g),'[]'::jsonb))
$$;

create function public.knowledge_question_manifest(p_generation uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with candidates as (
  select i.id,s.target,coalesce(a.title,'站内公开问答') title,octet_length(i.content) bytes,i.source_key,i.source_hash,
   row_number() over(partition by s.target order by case when s.chunk_type in ('body','qa') then 0 else 1 end,i.source_key,i.part,i.id) rn
  from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
  left join public.articles a on a.id=s.article_id
  where i.generation_id=p_generation and i.state='ready'
 ), sample as (select * from candidates order by rn,target,id limit 10)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'target',target,'title',title,'bytes',bytes,'sourceKey',source_key,'sourceHash',source_hash) order by rn,target,id),'[]'::jsonb) from sample
$$;
revoke all on function public.knowledge_question_manifest(uuid) from public,anon,authenticated;
grant execute on function public.knowledge_question_manifest(uuid) to service_role;

create or replace function public.dispatch_ai_call(p_request uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 update public.ai_calls set state='dispatched' where request_id=p_request and state='reserved' and expires_at>clock_timestamp()
  and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'
  and exists(select 1 from public.ai_settings s where s.id=1 and
   case when task in ('avatar','page','generation_probe','knowledge_questions','knowledge_preview') then s.generation_connection=connection_id
    when task in ('embedding_probe','knowledge_preview_retrieval') then s.embedding_connection=connection_id else true end
   and (task not in ('avatar','retrieval') or (s.avatar_enabled and (user_id is not null or s.anonymous_entry)
    and exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true'))))
  returning request_id into changed;
 return changed is not null;
end $$;

create function public.knowledge_missing_sources(p_targets text[]) returns text[]
language plpgsql stable security invoker set search_path='' as $$
begin
 if cardinality(p_targets)>300 then raise exception 'KNOWLEDGE_EVALUATION_CASE_INVALID'; end if;
 return array(select distinct target from unnest(p_targets) t(target) where not exists(select 1 from public.knowledge_sources s where s.target=t.target) order by target);
end $$;
revoke all on function public.knowledge_missing_sources(text[]) from public,anon,authenticated;
grant execute on function public.knowledge_missing_sources(text[]) to service_role;

update public.app_schema_version set version='20261022065829' where id=1;
commit;
