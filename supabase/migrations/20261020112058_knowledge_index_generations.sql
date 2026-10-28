begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.knowledge_index_generations (
 id uuid primary key default gen_random_uuid(),
 connection_id uuid not null references public.ai_connections(id),
 created_by uuid not null references auth.users(id),
 state text not null default 'building' check(state in ('building','ready','active','retired','failed')),
 preprocessing text not null default 'utf8-paragraph-v1' check(preprocessing='utf8-paragraph-v1'),
 approved_revision bigint not null,
 scan_cursor text not null default '',
 scan_complete boolean not null default false,
 provider_attempts integer not null default 0,
 threshold double precision check(threshold between -1 and 1),
 evaluation jsonb,
 evaluated_revision bigint,
 created_at timestamptz not null default now()
);
create unique index knowledge_one_active on public.knowledge_index_generations((true)) where state='active';
create unique index knowledge_one_pending on public.knowledge_index_generations((true)) where state in ('building','ready');
create table public.knowledge_index_control (
 id integer primary key check(id=1),
 source_revision bigint not null default 0,
 active_generation uuid references public.knowledge_index_generations(id)
);
insert into public.knowledge_index_control(id) values(1);
create table public.knowledge_index_items (
 id uuid primary key default gen_random_uuid(),
 generation_id uuid not null references public.knowledge_index_generations(id) on delete cascade,
 source_key text not null,
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 part integer not null check(part>=0),
 start_char integer not null check(start_char>=0),
 end_char integer not null check(end_char>start_char),
 content text not null check(octet_length(content) between 1 and 2048),
 embedding extensions.vector(1024),
 state text not null default 'pending' check(state in ('pending','leased','ready','failed','obsolete')),
 lease_id uuid,
 lease_expires_at timestamptz,
 attempts integer not null default 0,
 last_error text check(last_error ~ '^[A-Z0-9_]{1,80}$'),
 unique(generation_id,source_key,source_hash,part),
 check(state<>'ready' or (embedding is not null and extensions.vector_norm(embedding)>0)),
 check((state='leased')=(lease_id is not null and lease_expires_at is not null))
);
create index knowledge_items_source on public.knowledge_index_items(source_key,source_hash);
create index knowledge_items_claim on public.knowledge_index_items(generation_id,state,id);

create table public.knowledge_evaluations (
 id uuid primary key default gen_random_uuid(),
 generation_id uuid not null references public.knowledge_index_generations(id) on delete cascade,
 source_revision bigint not null,
 digest text not null check(digest ~ '^[0-9a-f]{64}$'),
 cases jsonb not null check(jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 40 and 100),
 results jsonb not null default '[]' check(jsonb_typeof(results)='array'),
 next_case integer not null default 0 check(next_case>=0),
 state text not null default 'pending' check(state in ('pending','leased','failed','complete')),
 lease_id uuid,
 lease_expires_at timestamptz,
 leased_count integer not null default 0 check(leased_count between 0 and 16),
 attempts integer not null default 0,
 check((state='leased')=(lease_id is not null and lease_expires_at is not null)),
 unique(generation_id,source_revision,digest)
);
alter table public.knowledge_evaluations enable row level security;
revoke all on public.knowledge_evaluations from public,anon,authenticated;
grant select,insert,update,delete on public.knowledge_evaluations to service_role;

alter table public.knowledge_index_generations enable row level security;
alter table public.knowledge_index_control enable row level security;
alter table public.knowledge_index_items enable row level security;
revoke all on public.knowledge_index_generations,public.knowledge_index_control,public.knowledge_index_items from public,anon,authenticated;
grant select,insert,update,delete on public.knowledge_index_generations,public.knowledge_index_control,public.knowledge_index_items to service_role;

-- Only current published/paused sources. Raw conversations never appear in this view.
create view public.knowledge_sources with(security_invoker=true) as
select s.source_key,s.target,s.article_id,s.chunk_type,s.access,s.content,
 encode(sha256(convert_to(s.content,'UTF8')),'hex') source_hash
from (
 select 'chunk:'||c.id source_key,'article:'||a.slug target,a.id article_id,c.chunk_type,a.access,
  replace(replace(c.content,chr(13)||chr(10),chr(10)),chr(13),chr(10)) content
 from public.article_chunks c join public.articles a on a.id=c.article_id
 left join public.series p on p.id=a.series_id
 where a.status in ('published','paused') and (a.type='blog' or (p.id is not null and p.status in ('published','paused')))
 union all
 select 'qa:'||q.conversation_id,case when a.id is null then 'qa:'||q.conversation_id else 'article:'||a.slug end,
  q.article_id,'qa'::text as chunk_type,'public'::text as access,replace(replace('问题：'||q.question_md||chr(10)||chr(10)||'回答：'||q.answer_md,chr(13)||chr(10),chr(10)),chr(13),chr(10)) as content
 from public.conversation_publications q left join public.articles a on a.id=q.article_id
 left join public.series p on p.id=a.series_id
 where q.article_id is null or (a.status in ('published','paused') and (a.type='blog' or (p.id is not null and p.status in ('published','paused'))))
) s where length(btrim(s.content))>0;
revoke all on public.knowledge_sources from public,anon,authenticated;
grant select on public.knowledge_sources to service_role;

create function public.refresh_ai_public_state() returns boolean
language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; available boolean; projection jsonb;
begin
 select * into cfg from public.ai_settings where id=1;
 available:=cfg.avatar_enabled and cfg.embedding_connection is not null
  and exists(select 1 from public.ai_connections where id=cfg.generation_connection and verified_at is not null)
  and exists(select 1 from public.knowledge_index_control c join public.knowledge_index_generations g on g.id=c.active_generation
   join public.ai_connections k on k.id=g.connection_id where c.id=1 and g.state='active' and k.verified_at is not null
   and exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
    where i.generation_id=g.id and i.state='ready'));
 projection:=jsonb_strip_nulls(jsonb_build_object('enabled',coalesce(available,false),'anonymous_entry',cfg.anonymous_entry,'monthly_limit',cfg.monthly_limit));
 if available then projection:=projection||'{"knowledge_ready":true}'::jsonb; end if;
 update public.site_config set avatar_config=projection where id=1 and avatar_config is distinct from projection;
 return coalesce(available,false);
end $$;

-- Trigger code has no public entry point. Source writes already require owner/service authority.
create schema if not exists ai_internal;
revoke all on schema ai_internal from public,anon,authenticated;
create function ai_internal.knowledge_sources_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.knowledge_index_control set source_revision=source_revision+1 where id=1;
 update public.knowledge_index_generations set scan_cursor='',scan_complete=false,evaluation=null,evaluated_revision=null,
  state=case when state='ready' then 'building' else state end where state in ('building','ready','active');
 perform public.refresh_ai_public_state();
 return null;
end $$;
revoke all on function ai_internal.knowledge_sources_changed() from public,anon,authenticated,service_role;
create trigger knowledge_chunk_changed after insert or update or delete on public.article_chunks
 for each statement execute function ai_internal.knowledge_sources_changed();
create trigger knowledge_article_changed after insert or update or delete on public.articles
 for each statement execute function ai_internal.knowledge_sources_changed();
create trigger knowledge_series_changed after insert or update or delete on public.series
 for each statement execute function ai_internal.knowledge_sources_changed();
create trigger knowledge_publication_changed after insert or update or delete on public.conversation_publications
 for each statement execute function ai_internal.knowledge_sources_changed();
create function ai_internal.ai_configuration_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.refresh_ai_public_state();
 return null;
end $$;
revoke all on function ai_internal.ai_configuration_changed() from public,anon,authenticated,service_role;
create trigger ai_settings_public_state after update on public.ai_settings
 for each statement execute function ai_internal.ai_configuration_changed();

create function public.begin_knowledge_index(p_owner uuid,p_consent boolean,p_generation uuid default null,p_expected_revision bigint default null,p_expected_connection uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare epoch bigint; selected_connection uuid; result_id uuid;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_consent is distinct from true then raise exception 'KNOWLEDGE_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 if p_expected_revision is not null and p_expected_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_generation is not null then
  if exists(select 1 from public.knowledge_index_generations where id=p_generation and state='failed')
   and exists(select 1 from public.knowledge_index_generations where id<>p_generation and state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
  update public.knowledge_index_generations set approved_revision=epoch,state=case when state='failed' then 'building' else state end
   where id=p_generation and state in ('building','active','failed') returning id into result_id;
  if result_id is null then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
  return result_id;
 end if;
 select s.embedding_connection into selected_connection from public.ai_settings s join public.ai_connections c on c.id=s.embedding_connection
  where s.id=1 and c.verified_at is not null;
 if selected_connection is null then raise exception 'KNOWLEDGE_CONNECTION_UNVERIFIED'; end if;
 if p_expected_connection is not null and selected_connection<>p_expected_connection then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 if not exists(select 1 from public.knowledge_sources) then raise exception 'KNOWLEDGE_EMPTY'; end if;
 if exists(select 1 from public.knowledge_index_generations where state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
 insert into public.knowledge_index_generations(connection_id,created_by,approved_revision) values(selected_connection,p_owner,epoch) returning id into result_id;
 return result_id;
end $$;

create function public.register_knowledge_source(p_generation uuid,p_source text,p_hash text,p_parts jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations; source public.knowledge_sources; v_part jsonb; position_char integer:=0; n integer:=0; expected text;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','active') then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
 if generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 select * into source from public.knowledge_sources where source_key=p_source;
 if not found or source.source_hash is distinct from p_hash then return false; end if;
 if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts) not between 1 and 4096 then raise exception 'KNOWLEDGE_PARTS_INVALID'; end if;
 for v_part in select value from jsonb_array_elements(p_parts) loop
  if (v_part->>'start')::integer is distinct from position_char or (v_part->>'end')::integer<=position_char then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
  expected:=substring(source.content from position_char+1 for (v_part->>'end')::integer-position_char);
  if v_part->>'content' is distinct from expected or octet_length(expected) not between 1 and 2048 then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
  insert into public.knowledge_index_items(generation_id,source_key,source_hash,part,start_char,end_char,content)
   values(p_generation,p_source,p_hash,n,position_char,(v_part->>'end')::integer,expected) on conflict(generation_id,source_key,source_hash,part) do update
    set state=case when knowledge_index_items.state='obsolete' then case when knowledge_index_items.embedding is null then 'pending' else 'ready' end else knowledge_index_items.state end;
  position_char:=(v_part->>'end')::integer;n:=n+1;
 end loop;
 if position_char<>length(source.content) then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
 update public.knowledge_index_items set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation and source_key=p_source and source_hash<>p_hash;
 update public.knowledge_index_generations set scan_cursor=greatest(scan_cursor,p_source) where id=p_generation;
 return true;
end $$;

create function public.complete_knowledge_scan(p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','active') or generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if exists(select 1 from public.knowledge_sources where source_key>generation.scan_cursor) then return false; end if;
 update public.knowledge_index_generations set scan_complete=true where id=p_generation;
 update public.knowledge_index_items i set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation
  and not exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash);
 return true;
end $$;

create function public.claim_knowledge_batch(p_generation uuid,p_lease uuid)
returns table(item_id uuid,content text) language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if p_lease is null then raise exception 'KNOWLEDGE_LEASE_INVALID'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','active') or not generation.scan_complete then raise exception 'KNOWLEDGE_SCAN_REQUIRED'; end if;
 if generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 update public.knowledge_index_items set state='failed',last_error='LEASE_EXPIRED_UNKNOWN',lease_id=null,lease_expires_at=null
  where generation_id=p_generation and state='leased' and lease_expires_at<=clock_timestamp();
 if exists(select 1 from public.knowledge_index_items where generation_id=p_generation and state='failed') then return; end if;
 return query with selected as (
  select i.id from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
  where i.generation_id=p_generation and i.state='pending' order by i.id for update of i skip locked limit 16
 ), changed as (
  update public.knowledge_index_items i set state='leased',lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1
  from selected where i.id=selected.id returning i.id,i.content
 ) select id,changed.content from changed;
 if found then update public.knowledge_index_generations set provider_attempts=provider_attempts+1 where id=p_generation; end if;
end $$;

create function public.finish_knowledge_batch(p_generation uuid,p_lease uuid,p_vectors jsonb,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare leased integer; item jsonb; row_id uuid; parsed extensions.vector(1024);
begin
 perform 1 from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state in ('building','active') for update;
 if not found then return false; end if;
 select count(*) into leased from public.knowledge_index_items where generation_id=p_generation and state='leased' and lease_id=p_lease and lease_expires_at>clock_timestamp();
 if leased=0 then return false; end if;
 if p_error is not null then
  if p_error !~ '^[A-Z0-9_]{1,80}$' then raise exception 'KNOWLEDGE_ERROR_INVALID'; end if;
  update public.knowledge_index_items set state='failed',last_error=p_error,lease_id=null,lease_expires_at=null where generation_id=p_generation and state='leased' and lease_id=p_lease;
  return true;
 end if;
 if jsonb_typeof(p_vectors)<>'array' or jsonb_array_length(p_vectors)<>leased
  or (select count(distinct value->>'id') from jsonb_array_elements(p_vectors))<>leased then raise exception 'KNOWLEDGE_VECTOR_COUNT_INVALID'; end if;
 for item in select value from jsonb_array_elements(p_vectors) loop
  row_id:=(item->>'id')::uuid; parsed:=(item->>'vector')::extensions.vector(1024);
  if parsed is null or extensions.vector_norm(parsed)<=0 then raise exception 'KNOWLEDGE_VECTOR_INVALID'; end if;
  if not exists(select 1 from public.knowledge_index_items where id=row_id and generation_id=p_generation and state='leased' and lease_id=p_lease and lease_expires_at>clock_timestamp()) then raise exception 'KNOWLEDGE_LEASE_LOST'; end if;
  update public.knowledge_index_items i set embedding=parsed,state=case when exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash) then 'ready' else 'obsolete' end,
   lease_id=null,lease_expires_at=null,last_error=null where i.id=row_id;
 end loop;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create function public.retry_knowledge_failures(p_owner uuid,p_generation uuid,p_confirm_unknown boolean) returns integer
language plpgsql security invoker set search_path='' as $$
declare count_items integer;
begin
 if p_confirm_unknown is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_RETRY_CONFIRMATION_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 for update;
 update public.knowledge_index_items set state='pending',last_error=null,lease_id=null,lease_expires_at=null where generation_id=p_generation
  and (state='failed' or (state='leased' and lease_expires_at<=clock_timestamp()));
 get diagnostics count_items=row_count;
 return count_items;
end $$;

create function public.match_knowledge(p_generation uuid,p_embedding extensions.vector,p_threshold double precision default -1,p_limit integer default 24,p_pins text[] default '{}')
returns table(item_id uuid,source_key text,target text,article_id bigint,chunk_type text,access text,content text,score double precision)
language sql stable security invoker set search_path='' as $$
 select i.id,s.source_key,s.target,s.article_id,s.chunk_type,s.access,i.content,
  1-(i.embedding operator(extensions.<=>) p_embedding) score
 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
 where i.generation_id=p_generation and i.state='ready' and extensions.vector_dims(p_embedding)=1024 and extensions.vector_norm(p_embedding)>0
  and p_threshold between -1 and 1 and cardinality(p_pins)<=3
  and 1-(i.embedding operator(extensions.<=>) p_embedding)>=p_threshold
 order by case when s.target=any(p_pins) then 0 else 1 end,i.embedding operator(extensions.<=>) p_embedding,i.id
 limit least(greatest(p_limit,1),24)
$$;

-- Evaluation is submitted by the service after bounded real-model holdout tests.
create function public.confirm_knowledge_evaluation(p_generation uuid,p_revision bigint,p_threshold double precision,p_evaluation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.knowledge_index_control where id=1 and source_revision=p_revision for update;
 if not found then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_threshold is null or p_threshold not between -1 and 1 or p_evaluation->>'passed' is distinct from 'true'
  or coalesce((p_evaluation->>'positiveCases')::integer,0)<20 or coalesce((p_evaluation->>'negativeCases')::integer,0)<20
  or coalesce((p_evaluation->>'holdoutRecall')::numeric,0)<0.9 or coalesce((p_evaluation->>'holdoutFalsePositives')::integer,-1)<>0
  or coalesce(p_evaluation->>'digest','') !~ '^[0-9a-f]{64}$' then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 if not exists(select 1 from public.knowledge_index_generations where id=p_generation and scan_complete and approved_revision=p_revision and state='building')
  or exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 update public.knowledge_index_generations set state='ready',threshold=p_threshold,evaluation=p_evaluation,evaluated_revision=p_revision where id=p_generation;
 return true;
end $$;
create function public.activate_knowledge_index(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'ready' or generation.evaluated_revision is distinct from epoch or not generation.scan_complete then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 if not exists(select 1 from public.ai_settings where id=1 and embedding_connection=generation.connection_id)
  or not exists(select 1 from public.ai_connections where id=generation.connection_id and verified_at is not null) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 update public.knowledge_index_generations set state='retired' where state='active';
 update public.knowledge_index_generations set state='active' where id=p_generation;
 update public.knowledge_index_control set active_generation=p_generation where id=1;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 40 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases) values(p_generation,epoch,case_digest,p_cases)
  on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

create function public.claim_knowledge_evaluation(p_run uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; run public.knowledge_evaluations; n integer;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into run from public.knowledge_evaluations where id=p_run for update;
 if not found or run.source_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_lease is null then raise exception 'KNOWLEDGE_LEASE_INVALID'; end if;
 if run.state='leased' and run.lease_expires_at<=clock_timestamp() then
  update public.knowledge_evaluations set state='failed',lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run;
  return jsonb_build_object('state','failed');
 end if;
 if run.state<>'pending' then return jsonb_build_object('state',run.state); end if;
 n:=least(16,jsonb_array_length(run.cases)-run.next_case);
 update public.knowledge_evaluations set state='leased',lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '90 seconds',leased_count=n,attempts=attempts+1 where id=p_run;
 return jsonb_build_object('state','leased','generationId',run.generation_id,'offset',run.next_case,
  'cases',(select jsonb_agg(value order by ordinality) from jsonb_array_elements(run.cases) with ordinality where ordinality>run.next_case and ordinality<=run.next_case+n));
end $$;

create function public.finish_knowledge_evaluation(p_run uuid,p_lease uuid,p_results jsonb,p_failed boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; run public.knowledge_evaluations;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into run from public.knowledge_evaluations where id=p_run for update;
 if not found or run.source_revision<>epoch or run.state<>'leased' or run.lease_id<>p_lease or run.lease_expires_at<=clock_timestamp() then return false; end if;
 if p_failed then
  update public.knowledge_evaluations set state='failed',lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run;
  return true;
 end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)<>run.leased_count then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 update public.knowledge_evaluations set results=results||p_results,next_case=next_case+leased_count,
  state=case when next_case+leased_count=jsonb_array_length(cases) then 'complete' else 'pending' end,
  lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run;
 return true;
end $$;

create function public.retry_knowledge_evaluation(p_owner uuid,p_run uuid,p_confirm_unknown boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_confirm_unknown is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_RETRY_CONFIRMATION_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 for update;
 update public.knowledge_evaluations set state='pending',lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run
  and (state='failed' or (state='leased' and lease_expires_at<=clock_timestamp()));
 return found;
end $$;

create function public.knowledge_index_status() returns jsonb
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
   'id',g.id,'connectionId',g.connection_id,'state',g.state,'scanCursor',g.scan_cursor,'scanComplete',g.scan_complete,
   'approvedRevision',g.approved_revision,'providerAttempts',g.provider_attempts,'threshold',g.threshold,
   'evaluation',g.evaluation,'evaluatedRevision',g.evaluated_revision,
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

create function public.discard_knowledge_generation(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 for update;
 if exists(select 1 from public.knowledge_index_generations where id=p_generation and state='active') then raise exception 'KNOWLEDGE_ACTIVE_DELETE_DENIED'; end if;
 delete from public.knowledge_index_generations where id=p_generation;
 return found;
end $$;

revoke all on function public.refresh_ai_public_state(),public.begin_knowledge_index(uuid,boolean,uuid,bigint,uuid),public.register_knowledge_source(uuid,text,text,jsonb),
 public.complete_knowledge_scan(uuid),public.claim_knowledge_batch(uuid,uuid),public.finish_knowledge_batch(uuid,uuid,jsonb,text),public.retry_knowledge_failures(uuid,uuid,boolean),
 public.knowledge_index_status(),public.discard_knowledge_generation(uuid,uuid),public.match_knowledge(uuid,extensions.vector,double precision,integer,text[]),public.confirm_knowledge_evaluation(uuid,bigint,double precision,jsonb),public.activate_knowledge_index(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.refresh_ai_public_state(),public.begin_knowledge_index(uuid,boolean,uuid,bigint,uuid),public.register_knowledge_source(uuid,text,text,jsonb),
 public.complete_knowledge_scan(uuid),public.claim_knowledge_batch(uuid,uuid),public.finish_knowledge_batch(uuid,uuid,jsonb,text),public.retry_knowledge_failures(uuid,uuid,boolean),
 public.knowledge_index_status(),public.discard_knowledge_generation(uuid,uuid),public.match_knowledge(uuid,extensions.vector,double precision,integer,text[]),public.confirm_knowledge_evaluation(uuid,bigint,double precision,jsonb),public.activate_knowledge_index(uuid,uuid) to service_role;
revoke all on function public.begin_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.claim_knowledge_evaluation(uuid,uuid),public.finish_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.retry_knowledge_evaluation(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.begin_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.claim_knowledge_evaluation(uuid,uuid),public.finish_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.retry_knowledge_evaluation(uuid,uuid,boolean) to service_role;
update public.app_schema_version set version='20261020112058',applied_at=now() where id=1;
notify pgrst,'reload schema';
commit;
