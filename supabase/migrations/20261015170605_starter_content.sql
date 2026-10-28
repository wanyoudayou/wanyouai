begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.starter_imports (
 id text primary key check(id='getting-started-v1'),
 template_hash text not null check(template_hash ~ '^[a-f0-9]{64}$'),
 objects jsonb not null check(jsonb_typeof(objects)='object'),
 published_count integer not null default 0 check(published_count between 0 and 8),
 completed boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.starter_imports enable row level security;
create policy starter_owner_read on public.starter_imports for select to authenticated using((select public.is_owner()));
create policy starter_service on public.starter_imports for all to service_role using(true) with check(true);
revoke all on public.starter_imports from public,anon,authenticated,service_role;
grant select on public.starter_imports to authenticated;
grant select,insert,update on public.starter_imports to service_role;

-- Reserve the page, parent and chapter metadata together. Bodies, versions and
-- chunks are still produced exclusively by the standard publication pipeline.
create function public.prepare_starter_content(p_hash text,p_html text,p_articles jsonb) returns jsonb
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
   or exists(select 1 from public.articles where slug in(select value->>'slug' from jsonb_array_elements(p_articles))) then raise exception 'STARTER_SLUG_CONFLICT'; end if;
 insert into public.series(slug,type,title,task,price,status,nav_enabled,nav_label,nav_order)
 values('getting-started','collection','使用指南','从部署到发布，了解本站系统的配置与日常使用。',0,'draft',false,'使用指南',100) returning * into parent;
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

-- A checkpoint and publication commit in one transaction. The wrapper narrows
-- the standard authority to reserved, unchanged, public starter chapters.
create function public.commit_starter_publication(p_request_id text,p_payload jsonb) returns jsonb
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
   -- Existing introduction rules: public, published and in this exact parent.
   if (select count(*) from public.articles a where a.id in(select (value->>'id')::bigint from jsonb_array_elements(job.objects->'articles'))
     and a.series_id=parent.id and a.type='chapter' and a.status='published' and a.access='public'
     and a.updated_at=(select (value->>'updated_at')::timestamptz from jsonb_array_elements(job.objects->'articles') where (value->>'id')::bigint=a.id))<>8 then raise exception 'STARTER_CONTENT_CHANGED'; end if;
   update public.series set readme_article_id=(job.objects->'articles'->0->>'id')::bigint,status='published',nav_enabled=true where id=parent.id;
   update public.custom_pages set status='published',placement='nav' where id=page.id;
 end if;
 update public.starter_imports set published_count=step+1,completed=(step=7),objects=job.objects,updated_at=now() where id=job.id;
 return result;
end $$;
revoke all on function public.commit_starter_publication(text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_starter_publication(text,jsonb) to service_role;
update public.app_schema_version set version='20261015170605' where id=1;
notify pgrst,'reload schema';
commit;
