begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- A pending-only document owns its slug before its first publication.
-- Refuse starter initialization before creating any objects in that case.
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

update public.app_schema_version set version='20261016055659' where id=1;
notify pgrst,'reload schema';
commit;
