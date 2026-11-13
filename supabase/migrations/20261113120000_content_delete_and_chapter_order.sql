begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Chapter order belongs to the album: every chapter, whether it came from the
-- starter import, the workbench, a folder import or a synced handbook, shares
-- one position list. A file staged for an existing article keeps that
-- article's position; a new chapter is appended after the album's last one.
create or replace function public.stage_content_file(p_scope text,p_path text,p_slug text,p_hash text,p_snapshot jsonb,p_expected bigint,p_request text)
returns bigint language plpgsql set search_path='' as $function$
declare f public.content_files%rowtype; r public.content_file_revisions%rowtype; result bigint; base timestamptz; next_sort integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(71003, pg_catalog.hashtext(p_scope || '/' || p_path));
  select * into f from public.content_files where scope=p_scope and path=p_path for update;
  select * into r from public.content_file_revisions where file_id=f.id order by version desc limit 1;
  select updated_at into base from public.articles where slug=p_slug;
  if r.input_hash=p_hash and coalesce(r.published_updated_at,r.base_updated_at) is not distinct from base then return r.id; end if;
  if coalesce(r.id,0) <> p_expected then raise exception 'IMPORT_STALE'; end if;
  if f.id is not null and f.article_slug <> p_slug then raise exception 'IMPORT_SLUG_CHANGED'; end if;
  if f.id is null then
    perform pg_catalog.pg_advisory_xact_lock(71004, pg_catalog.hashtext(p_scope));
    select a.sort_order into next_sort from public.articles a where a.slug=p_slug and p_scope like 'series:%';
    if next_sort is null then
      select greatest(
        coalesce((select max(sort) from public.content_files where scope=p_scope),0),
        coalesce((select max(a.sort_order) from public.articles a join public.series s on s.id=a.series_id where 'series:'||s.slug=p_scope),0)
      )+1 into next_sort;
    end if;
    insert into public.content_files(scope,path,article_slug,sort) values(p_scope,p_path,p_slug,next_sort) returning * into f;
  end if;
  select updated_at into base from public.articles where slug=p_slug;
  insert into public.content_file_revisions(file_id,version,input_hash,snapshot,base_updated_at,request_id)
    values(f.id,coalesce(r.version,0)+1,p_hash,p_snapshot,base,p_request) returning id into result;
  return result;
end $function$;
revoke all on function public.stage_content_file(text,text,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.stage_content_file(text,text,text,text,jsonb,bigint,text) to service_role;

-- Owner reorders all chapters of one album. Text, access and publication
-- status do not change; pending revisions are rebased so they stay publishable.
create or replace function public.order_series_chapters(p_series bigint,p_ids bigint[])
returns void language plpgsql set search_path='' as $function$
declare album public.series%rowtype; item record; previous_updated timestamptz; next_updated timestamptz; total integer;
begin
  select * into album from public.series where id=p_series for update;
  if album.id is null or album.status='archived' then raise exception 'ORDER_STALE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(71004, pg_catalog.hashtext('series:'||album.slug));
  total := coalesce(cardinality(p_ids),0);
  if total=0 or total>1000
    or total <> (select count(*) from public.articles where series_id=album.id)
    or total <> (select count(distinct x) from unnest(p_ids) x)
    or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.articles where id=x and series_id=album.id)) then
    raise exception 'ORDER_STALE';
  end if;
  for item in select a.id,a.slug,t.position::integer as position from unnest(p_ids) with ordinality as t(id,position) join public.articles a on a.id=t.id order by t.position loop
    select updated_at into previous_updated from public.articles where id=item.id for update;
    update public.articles set sort_order=item.position where id=item.id and sort_order<>item.position;
    select updated_at into next_updated from public.articles where id=item.id;
    update public.content_files set sort=item.position where scope='series:'||album.slug and article_slug=item.slug;
    update public.content_file_revisions r set base_updated_at=next_updated from public.content_files f
      where f.id=r.file_id and f.scope='series:'||album.slug and f.article_slug=item.slug and r.publication is null and r.base_updated_at=previous_updated;
    update public.content_file_revisions r set published_updated_at=next_updated from public.content_files f
      where f.id=r.file_id and f.scope='series:'||album.slug and f.article_slug=item.slug and r.publication is not null and r.published_updated_at=previous_updated;
  end loop;
  -- Files saved but never published follow after the published chapters, in their current order.
  update public.content_files f set sort=total+ranked.n from (
    select c.id,row_number() over (order by c.sort,c.id) n from public.content_files c
    where c.scope='series:'||album.slug and not exists(select 1 from public.articles a where a.slug=c.article_slug)
  ) ranked where f.id=ranked.id;
end $function$;
revoke all on function public.order_series_chapters(bigint,bigint[]) from public,anon,authenticated;
grant execute on function public.order_series_chapters(bigint,bigint[]) to service_role;

-- File-level ordering is replaced by album chapter order.
drop function public.order_content_files(text,bigint[]);

-- Owner deletes a free blog post or chapter nobody has paid for. Paid,
-- subscriber or sold content keeps the pause → archive lifecycle.
create or replace function public.delete_free_article(p_id bigint,p_expected_updated_at timestamptz)
returns jsonb language plpgsql set search_path='' as $function$
declare item public.articles%rowtype; album public.series%rowtype; parent_id bigint;
begin
  select series_id into parent_id from public.articles where id=p_id;
  if parent_id is not null then select * into album from public.series where id=parent_id for update; end if;
  select * into item from public.articles where id=p_id for update;
  if item.id is null then return jsonb_build_object('ok',false,'message','内容不存在'); end if;
  perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(item.slug));
  if p_expected_updated_at is null or item.updated_at<>p_expected_updated_at then
    return jsonb_build_object('ok',false,'message','内容已更新，请刷新后重试');
  end if;
  if item.type not in ('blog','chapter') then
    return jsonb_build_object('ok',false,'message','Skill 请在 Skill 管理中暂停或归档');
  end if;
  if item.access not in ('public','registered') then
    return jsonb_build_object('ok',false,'message','付费或订阅内容不能删除，请使用暂停与归档');
  end if;
  if album.id is not null and album.readme_article_id=item.id then
    return jsonb_build_object('ok',false,'message','此章节是专辑 README，请先更换 README');
  end if;
  if exists(select 1 from public.orders o where (o.sku_type='single' and o.target_id=item.id) or (album.id is not null and o.sku_type='series' and o.target_id=album.id))
    or exists(select 1 from public.entitlements e where (e.type='single' and e.target_id=item.id) or (album.id is not null and e.type='series' and e.target_id=album.id)) then
    return jsonb_build_object('ok',false,'message','已有订单或购买权益，不能删除，请使用暂停与归档');
  end if;
  delete from public.content_files where article_slug=item.slug;
  delete from public.articles where id=item.id;
  return jsonb_build_object('ok',true,'message','已删除','slug',item.slug,'type',item.type,
    'series_slug',album.slug,'series_type',album.type);
end $function$;
revoke all on function public.delete_free_article(bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.delete_free_article(bigint,timestamptz) to service_role;

update public.app_schema_version set version='20261113120000' where id=1;
notify pgrst,'reload schema';
commit;
