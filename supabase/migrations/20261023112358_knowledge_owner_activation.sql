begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.knowledge_evaluations drop constraint knowledge_evaluations_cases_check;
alter table public.knowledge_evaluations add constraint knowledge_evaluations_cases_check check(jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 1 and 100);
alter table public.knowledge_evaluations drop constraint knowledge_evaluations_policy_version_check;
alter table public.knowledge_evaluations add constraint knowledge_evaluations_policy_version_check check(policy_version in (1,2,3));
alter table public.knowledge_index_generations drop constraint knowledge_index_generations_accepted_policy_version_check;
alter table public.knowledge_index_generations add constraint knowledge_index_generations_accepted_policy_version_check check(accepted_policy_version in (2,3));

alter table public.knowledge_index_generations add column accepted_revision bigint;

-- A stable retrieval policy, independent of editable diagnostic questions.
-- Compatible incremental updates keep the serving cutoff; new mechanisms use 0.5.
create function public.knowledge_runtime_threshold(p_generation uuid) returns double precision
language sql stable security invoker set search_path='' as $$
 select coalesce(case when g.state='active' then g.threshold
  when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing then b.threshold end,0.5)
 from public.knowledge_index_generations g left join public.knowledge_index_generations b on b.id=g.base_generation where g.id=p_generation
$$;
revoke all on function public.knowledge_runtime_threshold(uuid) from public,anon,authenticated;
grant execute on function public.knowledge_runtime_threshold(uuid) to service_role;

create or replace function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state in ('building','ready','active') and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if p_cases is null or jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 1 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_cases) c where jsonb_typeof(c->'question') is distinct from 'string' or length(btrim(c->>'question'))=0 or octet_length(c->>'question')>1024
  or c->>'reviewed'='false' or jsonb_typeof(c->'expected') is distinct from 'array') then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_cases) c where jsonb_array_length(c->'expected')>3)
  or exists(select 1 from jsonb_array_elements(p_cases) c cross join lateral jsonb_array_elements_text(c->'expected') t(target) where target !~ '^(article:[a-z0-9-]{1,120}|qa:[0-9]{1,20})$')
  or (select count(distinct lower(regexp_replace(btrim(c->>'question'),'\s+',' ','g'))) from jsonb_array_elements(p_cases) c)<>jsonb_array_length(p_cases) then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or not exists(select 1 from public.knowledge_sources)
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if not public.knowledge_evaluation_sources_valid(array(select distinct jsonb_array_elements_text(value->'expected') from jsonb_array_elements(p_cases))) then raise exception 'KNOWLEDGE_EVALUATION_SOURCE_MISSING'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases,policy_version,fixed_threshold,regression_from)
 select p_generation,epoch,case_digest,p_cases,3,public.knowledge_runtime_threshold(g.id),
  case when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing then b.accepted_run end
 from public.knowledge_index_generations g left join public.knowledge_index_generations b on b.id=g.base_generation where g.id=p_generation
 on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

-- Retain old signatures for safe failures during an application rollout.
create or replace function public.confirm_knowledge_evaluation(p_generation uuid,p_revision bigint,p_threshold double precision,p_evaluation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin raise exception 'KNOWLEDGE_DIAGNOSTIC_ONLY'; end $$;
create or replace function public.accept_knowledge_preview(p_owner uuid,p_run uuid,p_accept_warnings boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end $$;

create or replace function public.activate_knowledge_index(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','ready','active') or generation.accepted_at is null
  or generation.accepted_by is distinct from p_owner or generation.accepted_policy_version is distinct from 3 or generation.accepted_revision is distinct from epoch then raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end if;
 if generation.approved_revision is distinct from epoch or not generation.scan_complete
  or not exists(select 1 from public.knowledge_sources)
  or exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 perform 1 from public.ai_settings where id=1 and embedding_connection=generation.connection_id for update;
 if not found then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 perform 1 from public.ai_connections where id=generation.connection_id and verified_at is not null for share;
 if not found then raise exception 'KNOWLEDGE_CONNECTION_UNVERIFIED'; end if;
 update public.knowledge_index_generations set state='retired' where state='active' and id<>p_generation;
 update public.knowledge_index_generations set state='active',threshold=public.knowledge_runtime_threshold(p_generation) where id=p_generation;
 update public.knowledge_index_control set active_generation=p_generation where id=1;
 perform public.refresh_ai_public_state();
 return true;
end $$;

-- Confirmation and switching are atomic. Neither a report nor its score grants authority.
create function public.enable_knowledge_index(p_owner uuid,p_generation uuid,p_revision bigint,p_connection uuid,p_confirm boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_confirm is distinct from true then raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 and source_revision=p_revision for update;
 if not found then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 perform 1 from public.knowledge_index_generations where id=p_generation and connection_id=p_connection and state in ('building','ready','active') for update;
 if not found then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 update public.knowledge_index_generations set accepted_by=p_owner,accepted_at=clock_timestamp(),accepted_policy_version=3,accepted_revision=p_revision where id=p_generation;
 return public.activate_knowledge_index(p_owner,p_generation);
end $$;
revoke all on function public.enable_knowledge_index(uuid,uuid,bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.enable_knowledge_index(uuid,uuid,bigint,uuid,boolean) to service_role;

update public.app_schema_version set version='20261023112358' where id=1;
commit;
