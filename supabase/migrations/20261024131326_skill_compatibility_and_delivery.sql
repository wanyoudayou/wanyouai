begin;
set local lock_timeout='5s';

-- Invoked explicitly after deploying the compatible application. No existing order,
-- entitlement, chapter body, or historical price snapshot is rewritten.
create function public.migrate_content_kinds(p_owner uuid) returns jsonb
language plpgsql set search_path='' as $$
declare old_series public.series%rowtype; intro text; fm jsonb; result jsonb; new_id bigint; converted integer:=0; handbooks integer;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('migrate-content-kinds',0));
 if exists(select 1 from public.series s where s.type='skill' and not exists(select 1 from public.skills k where k.legacy_series_id=s.id)
   and (exists(select 1 from public.articles a where a.slug=s.slug) or exists(select 1 from public.content_files f where f.article_slug=s.slug))) then
   raise exception 'SKILL_SLUG_CONFLICT: resolve conflicting article slugs before conversion';
 end if;
 for old_series in select s.* from public.series s where s.type='skill' and not exists(select 1 from public.skills k where k.legacy_series_id=s.id) order by s.id for update loop
   intro:=null;
   select b.content into intro from public.articles a join public.article_bodies b on b.article_id=a.id
    where a.id=old_series.readme_article_id and a.series_id=old_series.id and a.access='public';
   intro:=coalesce(intro,old_series.task,'');
   fm:=jsonb_build_object('title',old_series.title,'slug',old_series.slug,'type','skill','access','public','summary',coalesce(old_series.task,''));
   result:=public.commit_publication('legacy-skill-'||old_series.id::text,jsonb_build_object('frontmatter',fm,'markdown',intro,'preview',intro,
     'content_hash',encode(sha256(convert_to(fm::text||intro,'UTF8')),'hex'),'snapshot',jsonb_build_object('frontmatter',fm,'markdown',intro,'media','[]'::jsonb),'diagnostics','[]'::jsonb));
   if result->>'status' not in ('pass','needs_user_action') then raise exception 'SKILL_CONVERSION_BLOCKED'; end if;
   select id into new_id from public.articles where slug=old_series.slug and type='skill';
   if new_id is null then raise exception 'SKILL_CONVERSION_BLOCKED'; end if;
   update public.articles set status=old_series.status,paused_at=old_series.paused_at where id=new_id;
   update public.skills set price=old_series.price,legacy_series_id=old_series.id,updated_at=now() where id=new_id;
   converted:=converted+1;
 end loop;
 update public.series set type='handbook' where type='collection';
 get diagnostics handbooks=row_count;
 return jsonb_build_object('skills',converted,'handbooks',handbooks);
end $$;
revoke all on function public.migrate_content_kinds(uuid) from public,anon,authenticated;
grant execute on function public.migrate_content_kinds(uuid) to service_role;

-- Export reusable Skill metadata; runtime credentials and private chat history stay out.
create function public.export_site_snapshot(p_include_media boolean,p_include_skills boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
 with saved as materialized (select public.export_site_snapshot(p_include_media) value)
 select case when p_include_skills then saved.value || jsonb_build_object('rows',
   (saved.value->'rows') || jsonb_build_object(
     'skills',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.skills s),
     'skill_releases',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.skill_releases s)))
 else saved.value end from saved;
$$;
revoke all on function public.export_site_snapshot(boolean,boolean) from public,anon,authenticated;
grant execute on function public.export_site_snapshot(boolean,boolean) to service_role;

create or replace view public.admin_documents with (security_invoker=true) as
with files as (
 select f.id file_id,f.article_slug,f.scope,f.path,f.sort,
   h.id head_id,h.version head_version,h.created_at head_created_at,h.publication,
   case when h.publication is null then h.snapshot->'frontmatter'->>'title' end pending_title,
   case when h.publication is null then h.snapshot->'frontmatter'->>'access' end pending_access
 from public.content_files f
 left join lateral (select r.id,r.version,r.created_at,r.publication,r.snapshot
   from public.content_file_revisions r where r.file_id=f.id order by r.version desc limit 1) h on true
)
select coalesce('f:'||f.file_id::text,'a:'||a.id::text) document_key,
 a.id article_id,f.file_id,a.slug online_slug,coalesce(a.slug,f.article_slug) slug,
 coalesce(a.title,f.pending_title,f.article_slug) title,f.pending_title,
 concat_ws(' ',a.title,f.pending_title,f.article_slug) search_text,
 coalesce(a.type,case when f.scope='blog' then 'blog' when f.scope='skill' then 'skill' else 'chapter' end) type,
 coalesce(a.series_id,scoped.id) series_id,s.title series_title,s.slug series_slug,s.type series_type,
 a.status,a.paused_at,coalesce(a.access,f.pending_access,'public') access,a.price,coalesce(a.featured,false) featured,
 coalesce(a.sort_order,f.sort,0) sort_order,
 coalesce(f.scope,case when a.type='skill' then 'skill' when a.series_id is null then 'blog' else 'series:'||s.slug end) scope,f.path,
 case when f.publication is null then f.head_id end pending_revision_id,
 case when f.publication is null then f.head_version end pending_version,
 coalesce(v.version,0) online_version,
 coalesce(greatest(a.updated_at,case when f.publication is null then f.head_created_at end),f.head_created_at) updated_at,
 (a.id is not null and s.readme_article_id=a.id) is_readme
from public.articles a full join files f on f.article_slug=a.slug
left join public.series scoped on f.scope='series:'||scoped.slug
left join public.series s on s.id=coalesce(a.series_id,scoped.id)
left join lateral (select version from public.article_versions v where v.article_id=a.id order by version desc limit 1) v on true
where (select public.is_owner());

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
 values('getting-started','handbook','使用指南','从部署到发布，了解本站系统的配置与日常使用。',0,'draft',false,'使用指南',100) returning * into parent;
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


-- Restrictive policy survives an unrelated permissive Storage policy.
-- Signed capabilities are issued by the trusted server; API roles cannot list/read/write this bucket directly.
do $$ begin
 if to_regclass('storage.objects') is not null then
   execute 'create policy skill_packages_private on storage.objects as restrictive for all to anon,authenticated using (bucket_id <> ''skill-packages'') with check (bucket_id <> ''skill-packages'')';
 end if;
end $$;

-- A migrated skill and its retained legacy chapters share lifecycle, never transaction IDs.
create function public.sync_legacy_skill_lifecycle() returns trigger language plpgsql set search_path='' as $$
declare target bigint;
begin
 if new.status is not distinct from old.status then return new; end if;
 if tg_table_name='articles' and new.type='skill' then
   select legacy_series_id into target from public.skills where id=new.id;
   if target is not null then update public.series set status=new.status,paused_at=new.paused_at where id=target and status<>new.status; end if;
 elsif tg_table_name='series' and new.type='skill' then
   select id into target from public.skills where legacy_series_id=new.id;
   if target is not null then update public.articles set status=new.status,paused_at=new.paused_at where id=target and status<>new.status; end if;
 end if;
 return new;
end $$;
revoke all on function public.sync_legacy_skill_lifecycle() from public,anon,authenticated,service_role;
create trigger sync_legacy_skill_lifecycle after update of status on public.articles for each row execute function public.sync_legacy_skill_lifecycle();
create trigger sync_legacy_skill_lifecycle after update of status on public.series for each row execute function public.sync_legacy_skill_lifecycle();

-- Confirmations cannot commit after expiry. A one-hour grace also excludes in-flight uploads.
alter table public.skill_uploads add column cleaned_at timestamptz;
create function public.expired_skill_uploads(p_owner uuid,p_skill bigint) returns setof public.skill_uploads
language sql stable set search_path='' as $$
 select u.* from public.skill_uploads u where u.owner_id=p_owner and u.skill_id=p_skill
 and exists(select 1 from public.profiles where id=p_owner and is_owner)
 and u.release_id is null and u.cleaned_at is null and u.expires_at<now()-interval '1 hour'
 and (u.confirming_until is null or u.confirming_until<now()-interval '1 hour')
 and not exists(select 1 from public.skill_releases r where r.id=u.id)
 order by u.expires_at,u.id limit 10
$$;
revoke all on function public.expired_skill_uploads(uuid,bigint) from public,anon,authenticated;
grant execute on function public.expired_skill_uploads(uuid,bigint) to service_role;

update public.app_schema_version set version='20261024131326' where id=1;
notify pgrst,'reload schema';
commit;
