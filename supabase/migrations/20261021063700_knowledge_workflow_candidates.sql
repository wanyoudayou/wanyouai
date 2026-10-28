begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

select id from public.knowledge_index_control where id=1 for update;
do $idle$ begin
 if exists(select 1 from public.knowledge_index_items where state='leased' and lease_expires_at>clock_timestamp())
  or exists(select 1 from public.knowledge_evaluations where state='leased' and lease_expires_at>clock_timestamp()) then
  raise exception 'KNOWLEDGE_UPGRADE_REQUIRES_IDLE_TASKS';
 end if;
end $idle$;

alter table public.knowledge_index_generations
 add column mode text not null default 'rebuild' check(mode in ('initialize','sync','rebuild')),
 add column base_generation uuid references public.knowledge_index_generations(id) on delete set null;

alter table public.knowledge_index_items add column reused boolean not null default false;

update public.knowledge_index_generations set mode='initialize'
 where state in ('building','ready') and not exists(select 1 from public.knowledge_index_control where active_generation is not null);

create or replace function public.begin_knowledge_index(p_owner uuid,p_consent boolean,p_generation uuid default null,p_expected_revision bigint default null,p_expected_connection uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare epoch bigint; selected_connection uuid; result_id uuid;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_consent is distinct from true then raise exception 'KNOWLEDGE_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 if p_expected_revision is not null and p_expected_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_generation is not null then
  if not exists(select 1 from public.knowledge_index_generations g join public.ai_settings s on s.embedding_connection=g.connection_id where g.id=p_generation and s.id=1 and (p_expected_connection is null or g.connection_id=p_expected_connection)) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
  if exists(select 1 from public.knowledge_index_generations where id=p_generation and state='failed')
   and exists(select 1 from public.knowledge_index_generations where id<>p_generation and state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
  update public.knowledge_index_generations set approved_revision=epoch,state=case when state='failed' then 'building' else state end
   where id=p_generation and state in ('building','failed') returning id into result_id;
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

create or replace function public.register_knowledge_source(p_generation uuid,p_source text,p_hash text,p_parts jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations; source public.knowledge_sources; v_part jsonb; position_char integer:=0; n integer:=0; expected text;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'building' then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
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
 -- Only copy vectors after the new source coverage has been validated. Permission
 -- and source revision remain authoritative; no evaluation/lease is inherited.
 if generation.base_generation is not null then
  update public.knowledge_index_items dst set embedding=src.embedding,state='ready',reused=true
  from public.knowledge_index_items src, public.knowledge_index_generations base
  where dst.generation_id=p_generation and dst.source_key=p_source and dst.source_hash=p_hash and dst.state='pending'
   and base.id=generation.base_generation and base.connection_id=generation.connection_id and base.preprocessing=generation.preprocessing
   and src.generation_id=base.id and src.source_key=dst.source_key and src.source_hash=dst.source_hash
   and src.part=dst.part and src.start_char=dst.start_char and src.end_char=dst.end_char and src.content=dst.content
   and src.state='ready' and src.embedding is not null;
 end if;
 return true;
end $$;

create or replace function public.complete_knowledge_scan(p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'building' or generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if exists(select 1 from public.knowledge_sources where source_key>generation.scan_cursor) then return false; end if;
 update public.knowledge_index_generations set scan_complete=true where id=p_generation;
 update public.knowledge_index_items i set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation
  and not exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash);
 return true;
end $$;

create or replace function public.claim_knowledge_batch(p_generation uuid,p_lease uuid)
returns table(item_id uuid,content text) language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if p_lease is null then raise exception 'KNOWLEDGE_LEASE_INVALID'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'building' or not generation.scan_complete then raise exception 'KNOWLEDGE_SCAN_REQUIRED'; end if;
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

create or replace function public.finish_knowledge_batch(p_generation uuid,p_lease uuid,p_vectors jsonb,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare leased integer; item jsonb; row_id uuid; parsed extensions.vector(1024);
begin
 perform 1 from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' for update;
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
create function public.start_knowledge_task(p_owner uuid,p_mode text,p_consent boolean,p_revision bigint,p_connection uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare active public.knowledge_index_generations; result_id uuid; epoch bigint;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_consent is distinct from true then raise exception 'KNOWLEDGE_CONSENT_REQUIRED'; end if;
 if p_mode not in ('initialize','sync','rebuild') or p_mode is null then raise exception 'KNOWLEDGE_MODE_INVALID'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 if p_revision is distinct from epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if not exists(select 1 from public.ai_settings s join public.ai_connections c on c.id=s.embedding_connection
  where s.id=1 and s.embedding_connection=p_connection and c.verified_at is not null) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 select g.* into active from public.knowledge_index_control c join public.knowledge_index_generations g on g.id=c.active_generation where c.id=1;
 if p_mode='initialize' and active.id is not null then raise exception 'KNOWLEDGE_ALREADY_INITIALIZED'; end if;
 if p_mode='sync' then
  if active.id is null then raise exception 'KNOWLEDGE_INITIALIZE_REQUIRED'; end if;
  if active.connection_id<>p_connection or active.preprocessing<>'utf8-paragraph-v1' then raise exception 'KNOWLEDGE_REBUILD_REQUIRED'; end if;
  if exists(select 1 from public.knowledge_index_generations where state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
  if active.scan_complete and active.approved_revision=epoch
   and not exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i
    where i.generation_id=active.id and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then return active.id; end if;
 end if;
 result_id:=public.begin_knowledge_index(p_owner,true,null,epoch,p_connection);
 update public.knowledge_index_generations set mode=p_mode,base_generation=case when p_mode='sync' then active.id else null end where id=result_id;
 return result_id;
end $$;

-- Metadata-only source chooser. A literal substring search never treats user text
-- as SQL/ILIKE syntax and never returns source bodies or private conversations.
create function public.knowledge_source_choices(p_query text default '')
returns table(target text,title text) language sql stable security invoker set search_path='' as $$
 with choices as (
  select distinct s.target,coalesce(a.title,left(q.question_md,100),'公开问答') title
  from public.knowledge_sources s left join public.articles a on a.id=s.article_id
  left join public.conversation_publications q on s.source_key='qa:'||q.conversation_id
 )
 select c.target,c.title from choices c
 where length(coalesce(p_query,''))<=120 and (c.title ilike '%'||replace(replace(replace(coalesce(p_query,''),'\','\\'),'%','\%'),'_','\_')||'%'
  or c.target ilike '%'||replace(replace(replace(coalesce(p_query,''),'\','\\'),'%','\%'),'_','\_')||'%')
 order by c.title,c.target limit 30
$$;

create function public.knowledge_evaluation_sources_valid(p_targets text[])
returns boolean language sql stable security invoker set search_path='' as $$
 select cardinality(p_targets)<=300 and not exists(select 1 from unnest(p_targets) as expected(target)
  where not exists(select 1 from public.knowledge_sources s where s.target=expected.target))
$$;

create or replace function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
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
 if not public.knowledge_evaluation_sources_valid(array(select distinct jsonb_array_elements_text(value->'expected') from jsonb_array_elements(p_cases))) then raise exception 'KNOWLEDGE_EVALUATION_SOURCE_MISSING'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases) values(p_generation,epoch,case_digest,p_cases)
  on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

revoke all on function public.start_knowledge_task(uuid,text,boolean,bigint,uuid),public.knowledge_source_choices(text),public.knowledge_evaluation_sources_valid(text[]) from public,anon,authenticated;
grant execute on function public.start_knowledge_task(uuid,text,boolean,bigint,uuid),public.knowledge_source_choices(text),public.knowledge_evaluation_sources_valid(text[]) to service_role;

update public.app_schema_version set version='20261021063700' where id=1;
commit;
