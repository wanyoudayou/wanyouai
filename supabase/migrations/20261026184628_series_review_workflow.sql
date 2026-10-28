begin;
-- Owner settings are one optimistic transaction. Publication remains a separate explicit action.
create function public.save_series_settings(p_id bigint, p_expected timestamptz, p_values jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.series%rowtype; readme bigint;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 select * into s from public.series where id=p_id for update;
 if s.id is null or s.status='archived' or s.updated_at is distinct from p_expected then
   return jsonb_build_object('ok',false,'message','专辑已更新或归档，请刷新后重新核对。');
 end if;
 if jsonb_typeof(p_values)<>'object' or length(trim(p_values->>'title')) not between 1 and 200
   or length(coalesce(p_values->>'task',''))>300 or length(coalesce(p_values->>'nav_label',''))>80
   or abs((p_values->>'nav_order')::int)>10000
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
 nav_enabled=(p_values->>'nav_enabled')::boolean,nav_label=nullif(p_values->>'nav_label',''),nav_order=(p_values->>'nav_order')::int,
 featured=(p_values->>'featured')::boolean,price=case when s.type='event' then s.price else (p_values->>'price')::numeric end,
 readme_article_id=readme where id=s.id;
 return jsonb_build_object('ok',true,'message','专辑设置已保存；正文和上架状态未改变。');
end $$;
revoke all on function public.save_series_settings(bigint,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_series_settings(bigint,timestamptz,jsonb) to authenticated;

create function public.series_pending_revisions(p_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 with pending as (
 select r.id,r.version,f.path,f.article_slug slug,r.snapshot->'frontmatter'->>'title' title,
 r.snapshot->'frontmatter'->>'access' access
 from public.series s join public.content_files f on f.scope='series:'||s.slug
 join public.content_file_heads h on h.file_id=f.id join public.content_file_revisions r on r.id=h.id
 where s.id=p_id and r.publication is null
 ) select jsonb_build_object('total',(select count(*) from pending),'items',coalesce((select jsonb_agg(t order by t.path,t.id) from (select * from pending order by path,id limit 500) t),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.series_pending_revisions(bigint) from public,anon,authenticated,service_role;
grant execute on function public.series_pending_revisions(bigint) to authenticated;

-- Prepared payloads come only from the shared server publication validator. All selected chapters
-- commit together; an exception rolls back earlier chapters and their idempotency receipts.
create function public.commit_series_publication(p_series bigint,p_expected timestamptz,p_request uuid,p_items jsonb,p_activate boolean,p_readme text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' set statement_timeout='25s' as $$
declare s public.series%rowtype; r public.content_file_revisions%rowtype; f public.content_files%rowtype;
 item jsonb; result jsonb; results jsonb:='[]'; signature text; request_key text; current_updated timestamptz; readme_id bigint;
begin
 if p_request is null or p_activate is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 500
   or octet_length(p_items::text)>8388608 then raise exception 'BATCH_INVALID'; end if;
 if (select count(distinct (x->>'id')::bigint) from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'BATCH_INVALID'; end if;
 signature:=md5(jsonb_build_object('series',p_series,'expected',p_expected,'activate',p_activate,'readme',p_readme,'ids',(select jsonb_agg((x->>'id')::bigint order by (x->>'id')::bigint) from jsonb_array_elements(p_items) x))::text);
 request_key:='series-batch:'||p_request;
 perform pg_catalog.pg_advisory_xact_lock(71001,pg_catalog.hashtext(request_key));
 select response into result from public.publish_requests where client_request_id=request_key;
 if found then
   if result->>'batch_signature' is distinct from signature then raise exception 'BATCH_REPLAY_CHANGED'; end if;
   return result;
 end if;
 -- Match individual publication's revision -> file -> request -> article lock order.
 for item in select x from jsonb_array_elements(p_items) x order by (x->>'id')::bigint loop
   select * into r from public.content_file_revisions where id=(item->>'id')::bigint for update;
   if not found then raise exception 'BATCH_REVISION_MISSING'; end if;
   select * into f from public.content_files where id=r.file_id for update;
   perform pg_catalog.pg_advisory_xact_lock(71001,pg_catalog.hashtext(r.request_id));
   perform pg_catalog.pg_advisory_xact_lock(71002,pg_catalog.hashtext(f.article_slug));
 end loop;
 select * into s from public.series where id=p_series for update;
 if s.id is null or s.status='archived' or s.updated_at is distinct from p_expected then raise exception 'BATCH_SERIES_CHANGED'; end if;
 if p_activate and s.status<>'draft' then raise exception 'BATCH_ACTIVATION_INVALID'; end if;
 for item in select x from jsonb_array_elements(p_items) x order by (x->>'id')::bigint loop
   select * into r from public.content_file_revisions where id=(item->>'id')::bigint;
   select * into f from public.content_files where id=r.file_id;
   if f.scope<>'series:'||s.slug or r.snapshot is distinct from item->'payload'->'snapshot'
     or item->'payload'->'frontmatter' is distinct from r.snapshot->'frontmatter'
     or r.snapshot->'frontmatter'->>'series_slug' is distinct from s.slug
     or r.snapshot->'frontmatter'->>'slug' is distinct from f.article_slug
     or r.snapshot->'frontmatter'->>'type' is distinct from 'chapter' then raise exception 'BATCH_SCOPE_CHANGED'; end if;
   if exists(select 1 from public.content_file_revisions where file_id=f.id and version>r.version) then raise exception 'BATCH_REVISION_CHANGED'; end if;
   select updated_at into current_updated from public.articles where slug=f.article_slug;
   if current_updated is distinct from coalesce(r.published_updated_at,r.base_updated_at) then raise exception 'BATCH_ONLINE_CHANGED'; end if;
   result:=public.commit_file_publication(r.id,item->'payload');
   if result->>'status'='blocked' then raise exception 'BATCH_PUBLICATION_BLOCKED'; end if;
   results:=results||jsonb_build_array(result);
 end loop;
 if p_readme is not null then
   select id into readme_id from public.articles where series_id=s.id and slug=p_readme and access='public' and status in ('published','paused');
   if readme_id is null then raise exception 'BATCH_README_INVALID'; end if;
   update public.series set readme_article_id=readme_id where id=s.id and readme_article_id is distinct from readme_id;
 end if;
 if p_activate then
   select updated_at into current_updated from public.series where id=s.id;
   -- The service role is deliberately not an owner; enforce the same activation invariants here.
   if not exists(select 1 from public.series a join public.articles b on b.id=a.readme_article_id where a.id=s.id and b.series_id=s.id and b.access='public' and b.status in ('published','paused'))
     or (s.type='event' and not exists(select 1 from public.event_details where series_id=s.id)) then raise exception 'BATCH_README_OR_EVENT_REQUIRED'; end if;
   update public.series set status='published',paused_at=null where id=s.id;
 end if;
 result:=jsonb_build_object('status','pass','article',null,'diagnostics','[]'::jsonb,'revalidated','[]'::jsonb,'results',results,'batch_signature',signature,'activated',p_activate);
 insert into public.publish_requests(client_request_id,status,response) values(request_key,'pass',result);
 return result;
end $$;
revoke all on function public.commit_series_publication(bigint,timestamptz,uuid,jsonb,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.commit_series_publication(bigint,timestamptz,uuid,jsonb,boolean,text) to service_role;
update public.app_schema_version set version='20261026184628' where id=1;
notify pgrst,'reload schema';
commit;
