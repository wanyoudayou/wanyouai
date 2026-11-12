begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- One owner-managed source for custom sidebar entries: external links, custom
-- pages, albums and code sections. Built-in navigation stays in application code.
create table public.nav_items (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('external','page','series','section')),
  label text not null check (length(btrim(label)) between 1 and 40),
  icon text not null default 'link' check (icon ~ '^[a-z][a-z0-9-]{0,39}$'),
  url text check (url is null or (length(url) <= 2000 and url ~ '^https://[^[:space:]]+$')),
  page_id bigint references public.custom_pages(id) on delete cascade,
  series_id bigint references public.series(id) on delete cascade,
  section text check (section is null or section ~ '^[a-z][a-z0-9-]{1,39}$'),
  access text not null default 'public' check (access in ('public','login','subscriber')),
  enabled boolean not null default true,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nav_items_target check (
    (kind = 'external' and url is not null and page_id is null and series_id is null and section is null) or
    (kind = 'page' and page_id is not null and url is null and series_id is null and section is null) or
    (kind = 'series' and series_id is not null and url is null and page_id is null and section is null) or
    (kind = 'section' and section is not null and url is null and page_id is null and series_id is null)),
  constraint nav_items_access_scope check (kind = 'section' or access = 'public')
);
create unique index nav_items_page_key on public.nav_items(page_id) where page_id is not null;
create unique index nav_items_series_key on public.nav_items(series_id) where series_id is not null;
create unique index nav_items_section_key on public.nav_items(section) where section is not null;
create index nav_items_order on public.nav_items(sort_order, id);

alter table public.nav_items enable row level security;
create policy nav_items_owner_all on public.nav_items as permissive for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
revoke all on table public.nav_items from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.nav_items to authenticated;
grant select, insert, update, delete on table public.nav_items to service_role;
revoke all on sequence public.nav_items_id_seq from public, anon, authenticated, service_role;

-- Existing sidebar choices are copied into the new source with their labels and order.
insert into public.nav_items(kind, label, icon, series_id, sort_order)
select 'series', left(coalesce(nullif(btrim(s.nav_label), ''), s.title), 40),
  case s.type when 'event' then 'calendar' when 'skill' then 'wrench' else 'book-open' end,
  s.id, s.nav_order
from public.series s where s.nav_enabled;
insert into public.nav_items(kind, label, icon, page_id, sort_order)
select 'page', left(coalesce(nullif(btrim(p.nav_label), ''), p.title), 40), 'file-text',
  p.id, greatest(least(p.nav_order, 10000), -10000)
from public.custom_pages p where p.placement = 'nav';
-- The legacy columns (series.nav_enabled/nav_label/nav_order, custom_pages.placement='nav')
-- keep their values so the upgrade preserves existing data and an application rollback still
-- works. The application no longer reads or writes them; nav_items is the only source.

-- Public projection: enabled entries whose targets are readable by everyone.
-- Hidden targets, owner metadata and timestamps never leave this function.
create function public.public_navigation()
returns table(id bigint, kind text, label text, icon text, url text, page_slug text,
  series_slug text, series_type text, section text, access text)
language sql stable security definer set search_path='' as $$
  select n.id, n.kind, n.label, n.icon, n.url, p.slug, s.slug, s.type, n.section, n.access
  from public.nav_items n
  left join public.custom_pages p on p.id = n.page_id
  left join public.series s on s.id = n.series_id
  where n.enabled
    and (n.kind <> 'page' or p.status = 'published')
    and (n.kind <> 'series' or s.status in ('published','paused'))
  order by n.sort_order, n.id
  limit 100
$$;
revoke all on function public.public_navigation() from public, anon, authenticated, service_role;
grant execute on function public.public_navigation() to anon, authenticated, service_role;

create function public.nav_items_version() returns text
language sql stable security invoker set search_path='' as $$
  select coalesce(md5(string_agg(n.id::text || ':' || n.updated_at::text, ',' order by n.id)), 'empty')
  from public.nav_items n
$$;
revoke all on function public.nav_items_version() from public, anon, authenticated, service_role;
grant execute on function public.nav_items_version() to authenticated, service_role;

-- The admin page saves the whole ordered list as one optimistic transaction.
create function public.save_nav_items(p_expected text, p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; position integer := 0;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nav-items', 0));
  if public.nav_items_version() is distinct from p_expected then
    return jsonb_build_object('ok', false, 'message', '导航已被更新，请刷新后重新核对。');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50
    or exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object') then
    raise exception 'INVALID_NAVIGATION';
  end if;
  delete from public.nav_items where true;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.nav_items(kind, label, icon, url, page_id, series_id, section, access, enabled, sort_order)
    values (item->>'kind', btrim(item->>'label'), coalesce(item->>'icon', 'link'), nullif(item->>'url', ''),
      nullif(item->>'page_id', '')::bigint, nullif(item->>'series_id', '')::bigint, nullif(item->>'section', ''),
      coalesce(item->>'access', 'public'), coalesce((item->>'enabled')::boolean, true), position * 10);
    position := position + 1;
  end loop;
  return jsonb_build_object('ok', true, 'message', '导航已保存。', 'version', public.nav_items_version());
end $$;
revoke all on function public.save_nav_items(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_nav_items(text, jsonb) to authenticated;

-- Album settings no longer carry sidebar fields.
create or replace function public.save_series_settings(p_id bigint, p_expected timestamptz, p_values jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.series%rowtype; readme bigint;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 select * into s from public.series where id=p_id for update;
 if s.id is null or s.status='archived' or s.updated_at is distinct from p_expected then
   return jsonb_build_object('ok',false,'message','专辑已更新或归档，请刷新后重新核对。');
 end if;
 if jsonb_typeof(p_values)<>'object' or length(trim(p_values->>'title')) not between 1 and 200
   or length(coalesce(p_values->>'task',''))>300
   or jsonb_typeof(p_values->'tags')<>'array' or jsonb_array_length(p_values->'tags')>20
   or jsonb_typeof(p_values->'audiences')<>'array' or jsonb_array_length(p_values->'audiences')>20
   or exists(select 1 from jsonb_array_elements(p_values->'tags'||p_values->'audiences') x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>50)
   or (s.type<>'event' and (p_values->>'price' !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$')) then raise exception 'INVALID_SETTINGS'; end if;
 readme:=nullif(p_values->>'readme_article_id','')::bigint;
 if readme is not null and not exists(select 1 from public.articles where id=readme and series_id=s.id and access='public' and status in ('published','paused')) then
   return jsonb_build_object('ok',false,'message','README 必须是本专辑已发布的公开章节。');
 end if;
 if s.status<>'draft' and readme is null then return jsonb_build_object('ok',false,'message','已上架专辑需要保留公开 README。'); end if;
 update public.series set title=trim(p_values->>'title'),task=nullif(p_values->>'task',''),
 tags=array(select jsonb_array_elements_text(p_values->'tags')),audiences=array(select jsonb_array_elements_text(p_values->'audiences')),
 featured=(p_values->>'featured')::boolean,price=case when s.type='event' then s.price else (p_values->>'price')::numeric end,
 readme_article_id=readme where id=s.id;
 return jsonb_build_object('ok',true,'message','专辑设置已保存；正文和上架状态未改变。');
end $$;

create or replace function public.prepare_starter_content(p_hash text,p_html text,p_articles jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare job public.starter_imports%rowtype; parent public.series%rowtype; page public.custom_pages%rowtype;
 item public.articles%rowtype; descriptor jsonb; objects jsonb:='[]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('starter-content-v1',0));
 select * into job from public.starter_imports where id='getting-started-v1';
 if found then
   if job.template_hash<>p_hash then raise exception 'STARTER_TEMPLATE_CHANGED'; end if;
   return to_jsonb(job)-'objects';
 end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_html is null or length(p_html)>100000
   or coalesce(jsonb_typeof(p_articles),'')<>'array' or jsonb_array_length(p_articles)<>8 then raise exception 'INVALID_STARTER_TEMPLATE'; end if;
 if exists(select 1 from public.publish_requests where client_request_id ~ '^starter_v1_[0-7]$')
   or exists(select 1 from public.series where slug='getting-started') or exists(select 1 from public.custom_pages where slug='pricing')
   or exists(select 1 from public.articles where slug in(select value->>'slug' from jsonb_array_elements(p_articles)))
   or exists(select 1 from public.content_files where article_slug in(select value->>'slug' from jsonb_array_elements(p_articles))) then raise exception 'STARTER_SLUG_CONFLICT'; end if;
 insert into public.series(slug,type,title,task,price,status)
 values('getting-started','handbook','使用指南','从部署到发布，了解本站系统的配置与日常使用。',0,'draft') returning * into parent;
 insert into public.custom_pages(slug,title,description,html,status,placement,nav_label,nav_order)
 values('pricing','收费方案','了解阅读、订阅、内容购买与服务合作。',p_html,'draft','none','收费方案',90) returning * into page;
 for descriptor in select value from jsonb_array_elements(p_articles) loop
   if descriptor->>'slug' is null or descriptor->>'slug' !~ '^[a-z0-9][a-z0-9-]{1,119}$'
     or coalesce(length(descriptor->>'title'),0) not between 1 and 200
     or coalesce(descriptor->>'content_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_STARTER_ARTICLE'; end if;
   insert into public.articles(slug,series_id,type,title,access,status,sort_order)
   values(descriptor->>'slug',parent.id,'chapter',descriptor->>'title','public','draft',jsonb_array_length(objects)) returning * into item;
   objects:=objects||jsonb_build_array(jsonb_build_object('id',item.id,'slug',item.slug,'updated_at',item.updated_at,'content_hash',descriptor->>'content_hash'));
 end loop;
 insert into public.starter_imports(id,template_hash,objects) values('getting-started-v1',p_hash,
   jsonb_build_object('series_id',parent.id,'series_updated_at',parent.updated_at,'page_id',page.id,'page_updated_at',page.updated_at,'articles',objects)) returning * into job;
 return to_jsonb(job)-'objects';
end $$;
revoke all on function public.prepare_starter_content(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_starter_content(text,text,jsonb) to service_role;

create or replace function public.commit_starter_publication(p_request_id text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare job public.starter_imports%rowtype; descriptor jsonb; item public.articles%rowtype;
 parent public.series%rowtype; page public.custom_pages%rowtype; result jsonb; step integer;
begin
 select * into job from public.starter_imports where id='getting-started-v1' for update;
 if not found then raise exception 'STARTER_NOT_PREPARED'; end if;
 select response into result from public.publish_requests where client_request_id=p_request_id;
 if found then return result; end if;
 step:=job.published_count;
 if job.completed or step>=8 or p_request_id<>'starter_v1_'||step::text then raise exception 'STARTER_STEP_CHANGED'; end if;
 descriptor:=job.objects->'articles'->step;
 select * into item from public.articles where id=(descriptor->>'id')::bigint for update;
 if not found or item.updated_at is distinct from (descriptor->>'updated_at')::timestamptz
   or item.status<>'draft' or item.series_id<>(job.objects->>'series_id')::bigint
   or p_payload->'frontmatter'->>'slug'<>item.slug or p_payload->'frontmatter'->>'access'<>'public'
   or p_payload->'frontmatter'->>'type'<>'chapter' or p_payload->'frontmatter'->>'series_slug'<>'getting-started'
   or p_payload->>'content_hash' is distinct from descriptor->>'content_hash' then raise exception 'STARTER_CONTENT_CHANGED'; end if;
 if step=7 then
   select * into parent from public.series where id=(job.objects->>'series_id')::bigint for update;
   select * into page from public.custom_pages where id=(job.objects->>'page_id')::bigint for update;
   if parent.updated_at is distinct from (job.objects->>'series_updated_at')::timestamptz or parent.status<>'draft'
     or page.updated_at is distinct from (job.objects->>'page_updated_at')::timestamptz or page.status<>'draft' then raise exception 'STARTER_CONTENT_CHANGED'; end if;
 end if;
 result:=public.commit_publication(p_request_id,p_payload||jsonb_build_object('expected_updated_at',item.updated_at));
 if result->>'status'='blocked' or jsonb_typeof(result->'article') is distinct from 'object' then return result; end if;
 select * into item from public.articles where id=item.id;
 job.objects:=jsonb_set(job.objects,array['articles',step::text,'updated_at'],to_jsonb(item.updated_at));
 if step=7 then
   if (select count(*) from public.articles a where a.id in(select (value->>'id')::bigint from jsonb_array_elements(job.objects->'articles'))
     and a.series_id=parent.id and a.type='chapter' and a.status='published' and a.access='public'
     and a.updated_at=(select (value->>'updated_at')::timestamptz from jsonb_array_elements(job.objects->'articles') where (value->>'id')::bigint=a.id))<>8 then raise exception 'STARTER_CONTENT_CHANGED'; end if;
   update public.series set readme_article_id=(job.objects->'articles'->0->>'id')::bigint,status='published' where id=parent.id;
   update public.custom_pages set status='published' where id=page.id;
   insert into public.nav_items(kind,label,icon,page_id,sort_order) values('page','收费方案','credit-card',page.id,90)
     on conflict (page_id) where page_id is not null do nothing;
   insert into public.nav_items(kind,label,icon,series_id,sort_order) values('series','使用指南','book-open',parent.id,100)
     on conflict (series_id) where series_id is not null do nothing;
 end if;
 update public.starter_imports set published_count=step+1,completed=(step=7),objects=job.objects,updated_at=now() where id=job.id;
 return result;
end $$;
revoke all on function public.commit_starter_publication(text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_starter_publication(text,jsonb) to service_role;

-- Owner export keeps the navigation list with the rest of the site configuration.
create or replace function public.export_site_snapshot(p_include_media boolean,p_include_skills boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
 with saved as materialized (select public.export_site_snapshot(p_include_media) value),
 extended as (select case when p_include_skills then saved.value || jsonb_build_object('rows',
   (saved.value->'rows') || jsonb_build_object(
     'skills',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.skills s),
     'skill_releases',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.skill_releases s)))
 else saved.value end value from saved)
 select jsonb_set(extended.value,'{rows,nav_items}',
   (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.nav_items n),true) from extended;
$$;
revoke all on function public.export_site_snapshot(boolean,boolean) from public,anon,authenticated;
grant execute on function public.export_site_snapshot(boolean,boolean) to service_role;

update public.app_schema_version set version='20261111120000' where id=1;
notify pgrst,'reload schema';
commit;
