-- Existing deployments only. Apply once; do not rerun schema or seed.

-- Web imports: logical paths and immutable, owner-only pending revisions.
create table content_files (
  id bigint generated always as identity primary key,
  scope text not null,
  path text not null check (length(path) between 1 and 1024),
  article_slug text not null unique,
  sort integer not null default 0,
  unique(scope, path)
);
create table content_file_revisions (
  id bigint generated always as identity primary key,
  file_id bigint not null references content_files(id) on delete cascade,
  version integer not null check(version > 0),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null,
  base_updated_at timestamptz,
  request_id text not null unique,
  publication jsonb,
  published_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(file_id, version)
);
create table content_assets (
  scope text not null,
  path text not null check (length(path) between 1 and 1024),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  media jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(scope, path)
);
alter table content_files enable row level security;
alter table content_file_revisions enable row level security;
alter table content_assets enable row level security;

-- Import bodies and path inventory are visible only to the owner.
create policy content_files_owner_read on content_files for select to authenticated using ((select public.is_owner()));
create policy content_revisions_owner_read on content_file_revisions for select to authenticated using ((select public.is_owner()));
create policy content_assets_owner_read on content_assets for select to authenticated using ((select public.is_owner()));
revoke all on content_files, content_file_revisions, content_assets from anon, authenticated;
grant select on content_files, content_file_revisions, content_assets to authenticated;
grant all on content_files, content_file_revisions, content_assets to service_role;
grant usage, select on sequence content_files_id_seq, content_file_revisions_id_seq to service_role;

-- Reading order is independent of publication timestamps.
alter table articles add column sort_order integer not null default 0;
create view content_file_heads with (security_invoker = true) as
  select distinct on (file_id) id,file_id,version,input_hash,publication,created_at
  from content_file_revisions order by file_id,version desc;

grant select on content_file_heads to authenticated,service_role;
-- Run after schema, policies and publish. All writes use authenticated server paths.
create or replace function public.stage_content_file(p_scope text, p_path text, p_slug text, p_hash text, p_snapshot jsonb, p_expected bigint, p_request text)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare f public.content_files%rowtype; r public.content_file_revisions%rowtype; result bigint; base timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(71003, pg_catalog.hashtext(p_scope || '/' || p_path));
  select * into f from public.content_files where scope=p_scope and path=p_path for update;
  select * into r from public.content_file_revisions where file_id=f.id order by version desc limit 1;
  select updated_at into base from public.articles where slug=p_slug;
  if r.input_hash=p_hash and coalesce(r.published_updated_at,r.base_updated_at) is not distinct from base then return r.id; end if;
  if coalesce(r.id,0) <> p_expected then raise exception 'IMPORT_STALE'; end if;
  if f.id is not null and f.article_slug <> p_slug then raise exception 'IMPORT_SLUG_CHANGED'; end if;
  if f.id is null then
    insert into public.content_files(scope,path,article_slug,sort) values(p_scope,p_path,p_slug,(select coalesce(max(sort),0)+1 from public.content_files where scope=p_scope)) returning * into f;
  end if;
  select updated_at into base from public.articles where slug=p_slug;
  insert into public.content_file_revisions(file_id,version,input_hash,snapshot,base_updated_at,request_id)
    values(f.id,coalesce(r.version,0)+1,p_hash,p_snapshot,base,p_request) returning id into result;
  return result;
end $$;
revoke all on function public.stage_content_file(text,text,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.stage_content_file(text,text,text,text,jsonb,bigint,text) to service_role;

create or replace function public.commit_file_publication(p_revision bigint, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.content_file_revisions%rowtype; f public.content_files%rowtype; online_updated timestamptz; result jsonb;
begin
  select * into r from public.content_file_revisions where id=p_revision for update;
  if not found then raise exception 'REVISION_NOT_FOUND'; end if;
  if r.publication is not null then return r.publication; end if;
  select * into f from public.content_files where id=r.file_id for update;
  -- Same lock ordering as publication; serialize against direct workbench updates too.
  perform pg_catalog.pg_advisory_xact_lock(71001, pg_catalog.hashtext(r.request_id));
  perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(f.article_slug));
  select updated_at into online_updated from public.articles where slug=f.article_slug;
  if online_updated is distinct from r.base_updated_at then
    return jsonb_build_object('status','blocked','diagnostics',jsonb_build_array(jsonb_build_object('code','SCHEMA_INVALID','severity','error','message','线上内容已变化，请重新导入并审核。','path','')),'article',null,'revalidated','[]'::jsonb);
  end if;
  if exists(select 1 from public.content_file_revisions where file_id=f.id and version>r.version) then
    return jsonb_build_object('status','blocked','diagnostics',jsonb_build_array(jsonb_build_object('code','SCHEMA_INVALID','severity','error','message','已有更新的待发布修订，请审核最新版本。','path','')),'article',null,'revalidated','[]'::jsonb);
  end if;
  result := public.commit_publication(r.request_id,p_payload);
  if result->>'status' <> 'blocked' then
    update public.articles set sort_order=f.sort where slug=f.article_slug and sort_order<>f.sort;
    update public.content_file_revisions set publication=result, published_updated_at=(select updated_at from public.articles where slug=f.article_slug) where id=r.id;
  end if;
  return result;
end $$;
revoke all on function public.commit_file_publication(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.commit_file_publication(bigint,jsonb) to service_role;

create or replace function public.order_content_files(p_scope text,p_ids bigint[])
returns void language plpgsql security invoker set search_path = '' as $$
declare item record; previous_updated timestamptz; next_updated timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(71004,pg_catalog.hashtext(p_scope));
  if cardinality(p_ids) <> (select count(*) from public.content_files where scope=p_scope)
    or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
    or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.content_files where id=x and scope=p_scope)) then
    raise exception 'ORDER_STALE';
  end if;
  for item in select id,position from unnest(p_ids) with ordinality as t(id,position) loop
    update public.content_files set sort=item.position where id=item.id;
    -- Reordering does not alter text, access or publication status.
    select updated_at into previous_updated from public.articles where slug=(select article_slug from public.content_files where id=item.id);
    update public.articles set sort_order=item.position where slug=(select article_slug from public.content_files where id=item.id) and sort_order<>item.position;
    select updated_at into next_updated from public.articles where slug=(select article_slug from public.content_files where id=item.id);
    update public.content_file_revisions set base_updated_at=next_updated where file_id=item.id and publication is null and base_updated_at=previous_updated;
    update public.content_file_revisions set published_updated_at=next_updated where file_id=item.id and publication is not null and published_updated_at=previous_updated;
  end loop;
end $$;
revoke all on function public.order_content_files(text,bigint[]) from public,anon,authenticated;
grant execute on function public.order_content_files(text,bigint[]) to service_role;
