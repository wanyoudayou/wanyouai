-- Additive content capabilities and owner-only administration projections.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.series drop constraint series_type_check;
alter table public.series add constraint series_type_check check (type in ('collection','handbook','skill','event'));
alter table public.series add column nav_enabled boolean not null default false;
alter table public.series add column nav_label text check (length(nav_label)<=80);
alter table public.series add column nav_order integer not null default 0 check (nav_order between -10000 and 10000);
create index idx_articles_updated_id on public.articles(updated_at desc,id desc);
create index idx_series_updated_id on public.series(updated_at desc,id desc);
create index idx_bookings_status_created_id on public.bookings(status,created_at desc,id desc);
create index idx_revisions_file_version on public.content_file_revisions(file_id,version desc);

-- The latest file head and its formal publication are one logical document.
-- Only metadata is projected: no Markdown, HTML, messages or version snapshots.
create view public.admin_documents with (security_invoker=true) as
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
 coalesce(a.type,case when f.scope='blog' then 'blog' else 'chapter' end) type,
 coalesce(a.series_id,scoped.id) series_id,s.title series_title,s.slug series_slug,s.type series_type,
 a.status,a.paused_at,coalesce(a.access,f.pending_access,'public') access,a.price,coalesce(a.featured,false) featured,
 coalesce(a.sort_order,f.sort,0) sort_order,
 coalesce(f.scope,case when a.series_id is null then 'blog' else 'series:'||s.slug end) scope,f.path,
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
revoke all on public.admin_documents from public,anon,authenticated,service_role;
grant select on public.admin_documents to authenticated,service_role;

create view public.admin_collections with (security_invoker=true) as
select s.*,(select count(*)::int from public.articles a where a.series_id=s.id and a.type='chapter' and a.id is distinct from s.readme_article_id) chapter_count
from public.series s where (select public.is_owner());
revoke all on public.admin_collections from public,anon,authenticated,service_role;
grant select on public.admin_collections to authenticated,service_role;

-- Each overview card is independently queried and can fail without hiding others.
create function public.admin_dashboard_card(p_section text) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 if p_section='revenue' then return jsonb_build_object('revenueThisMonth',(select coalesce(sum(amount),0) from public.orders where status in ('paid','fulfilled') and updated_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'));
 elsif p_section='subscriptions' then return jsonb_build_object('activeSubscriptions',(select count(distinct user_id) from public.entitlements where type='subscription' and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())));
 elsif p_section='content' then return jsonb_build_object('seriesPublished',(select count(*) from public.series where status='published'),'articlesPublished',(select count(*) from public.articles where status='published'));
 elsif p_section='avatar' then return jsonb_build_object('avatarGenerationsThisMonth',(select count(*) from public.avatar_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),'avatarGenerationsTotal',(select count(*) from public.avatar_usage),'avatarCacheHitsTotal',(select coalesce(sum(hit_count),0) from public.avatar_cache));
 else raise exception 'INVALID_METRIC'; end if;
end $$;
revoke all on function public.admin_dashboard_card(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_dashboard_card(text) to authenticated;

-- Auth email is deliberately not exposed through a public view. Only the
-- trusted server can call this definer; its application entry checks owner.
create function public.admin_user_directory(p_q text default '',p_status text default '',p_sort text default 'newest',p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 if p_q is null or p_status is null or p_sort is null or p_offset is null or p_limit is null or length(p_q)>120 or p_status not in ('','subscribed','registered') or p_sort not in ('newest','oldest','active')
   or p_offset<0 or p_limit not in (20,50,100) then raise exception 'INVALID_LIST_QUERY'; end if;
 pattern := '%'||replace(replace(replace(coalesce(p_q,''),'\','\\'),'%','\%'),'_','\_')||'%';
 with directory as (
 select u.id,coalesce(u.email,'') email,u.created_at as "registeredAt",p.display_name as "displayName",
   coalesce(rights.active,false) as "subscriptionActive",rights.ends_at as "subscriptionEndsAt",
   greatest(u.created_at,rights.last_at,orders.last_at) as "lastActiveAt",coalesce(orders.count,0) as "orderCount"
 from auth.users u left join public.profiles p on p.id=u.id
 left join lateral (select bool_or(e.type='subscription' and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())) active,
   case when bool_or(e.type='subscription' and e.revoked_at is null and e.starts_at<=now() and e.ends_at is null) then null
     else max(e.ends_at) filter(where e.type='subscription' and e.revoked_at is null and e.starts_at<=now() and e.ends_at>now()) end ends_at,
   max(e.created_at) last_at from public.entitlements e where e.user_id=u.id) rights on true
 left join lateral (select count(*) count,max(o.created_at) last_at from public.orders o where o.user_id=u.id) orders on true
 where (coalesce(u.email,'') ilike pattern or coalesce(p.display_name,'') ilike pattern)
 ), filtered as (select * from directory where p_status='' or (p_status='subscribed' and "subscriptionActive") or (p_status='registered' and not "subscriptionActive")),
 page as (select * from filtered order by
   case when p_sort='newest' then "registeredAt" end desc,
   case when p_sort='oldest' then "registeredAt" end asc,
   case when p_sort='active' then "lastActiveAt" end desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'filteredTotal',(select count(*) from filtered)) into result;
 return result;
end $$;
revoke all on function public.admin_user_directory(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_user_directory(text,text,text,integer,integer) to service_role;

create or replace function public.create_pending_order(p_user_id uuid,p_sku text,p_target bigint,p_amount numeric)
returns jsonb language plpgsql set search_path='' as $$
declare v_price numeric; v_order public.orders%rowtype;
begin
  -- Revalidate the server price snapshot while holding a shared product/configuration lock.
  if p_sku='subscription' and p_target is null then
    select (commerce->'subscription_price'->>'amount')::numeric into v_price from public.site_config where id=1 for share;
  elsif p_sku='series' then
    select price into v_price from public.series where id=p_target and type in ('collection','handbook','skill') and status='published' for share;
  elsif p_sku='single' then
    select price into v_price from public.articles where id=p_target and type='blog' and series_id is null and access='paid' and status='published' for share;
  elsif p_sku='event' then
    select d.ticket_price into v_price from public.event_details d join public.series s on s.id=d.series_id
      where s.id=p_target and s.type='event' and s.status='published' and d.state in ('upcoming','registering') for share of s,d;
  end if;
  if v_price is null or v_price<=0 or p_amount is null or p_amount<>v_price then raise exception 'NOT_SELLABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || p_user_id::text || ':' || p_sku || ':' || coalesce(p_target::text,''),0));
  if exists(select 1 from public.entitlements e where e.user_id=p_user_id and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
    and (e.type='subscription' or (e.type=p_sku and e.target_id is not distinct from p_target))) then raise exception 'ALREADY_ENTITLED'; end if;
  select * into v_order from public.orders where user_id=p_user_id and sku_type=p_sku
    and target_id is not distinct from p_target and amount=v_price and status='pending' and provider='zpay'
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_order); end if;
  insert into public.orders(user_id,sku_type,target_id,amount) values(p_user_id,p_sku,p_target,v_price) returning * into v_order;
  return to_jsonb(v_order);
end $$;

CREATE OR REPLACE FUNCTION public.commit_publication(p_request_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  fm jsonb := p_payload->'frontmatter';
  item public.articles%rowtype;
  parent public.series%rowtype;
  latest public.article_versions%rowtype;
  diagnostics jsonb := coalesce(p_payload->'diagnostics', '[]'::jsonb);
  item_id bigint;
  next_version integer;
  detail text;
  content_url text;
  base text;
  paths jsonb;
  error_code text;
  error_message text;
begin
  perform pg_catalog.pg_advisory_xact_lock(71001, pg_catalog.hashtext(p_request_id));
  select response into result from public.publish_requests where client_request_id = p_request_id;
  if found then return result; end if;

  if p_payload->>'status' = 'blocked' then
    result := p_payload - 'status' || jsonb_build_object('status', 'blocked');
  else
    perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(fm->>'slug'));
    if fm->>'type' = 'chapter' then
      select * into parent from public.series where slug = fm->>'series_slug' for update;
      if not found then
        error_code := 'SERIES_NOT_FOUND'; error_message := '所属专辑不存在。';
      elsif parent.status = 'archived' then
        error_code := 'SCHEMA_INVALID'; error_message := '不能向已归档专辑发布。';
      end if;
    end if;
    select * into item from public.articles where slug = fm->>'slug' for update;
    if found and (item.status = 'archived' or item.type <> fm->>'type' or item.series_id is distinct from parent.id) then
      error_code := 'SCHEMA_INVALID'; error_message := '不能重发已归档文章或改变现有文章的类型和专辑归属。';
    end if;
    if p_payload ? 'expected_updated_at' and (item.id is null or item.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz) then
      error_code := 'SCHEMA_INVALID'; error_message := '内容已更新，请刷新后重试。';
    end if;
    if item.id is not null and parent.readme_article_id = item.id and fm->>'access' <> 'public' then
      error_code := 'SCHEMA_INVALID'; error_message := 'README 必须公开。';
    end if;
    if error_code is not null then
      diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', error_code, 'severity', 'error', 'message', error_message, 'path', '/frontmatter'));
      result := jsonb_build_object('status', 'blocked', 'diagnostics', diagnostics, 'article', null, 'revalidated', '[]'::jsonb);
    else
      if parent.price > 0 and fm->>'access' = 'subscriber' then
        diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', 'SUBSCRIBER_IN_PAID_SERIES', 'severity', 'warning', 'message', '订阅内容不参与专辑单卖。', 'path', '/frontmatter/access'));
      end if;
      if fm->>'type' = 'blog' then
        base := '/blog'; detail := base || '/' || (fm->>'slug');
      else
        base := case parent.type when 'collection' then '/collections' when 'handbook' then '/handbooks' when 'skill' then '/skills' when 'event' then '/events' end;
        detail := base || '/' || parent.slug;
      end if;
      paths := jsonb_build_array('/', base, detail, '/llms.txt', '/card', '/card.json');
      content_url := detail || case when parent.id is not null then '?article=' || (fm->>'slug') else '' end;
      select * into latest from public.article_versions where article_id = item.id order by version desc limit 1;
      if latest.content_hash = p_payload->>'content_hash' then
        next_version := latest.version;
      else
        insert into public.articles (slug, series_id, type, title, summary, cover_url, tags, access, price, preview_md, status, published_at)
        values (fm->>'slug', parent.id, fm->>'type', fm->>'title', fm->>'summary', p_payload->>'cover',
          array(select jsonb_array_elements_text(coalesce(fm->'tags', '[]'::jsonb))), fm->>'access', (fm->>'price')::numeric,
          p_payload->>'preview', coalesce(nullif(item.status, 'draft'), 'published'), coalesce((fm->>'published_at')::timestamptz, item.published_at, now()))
        on conflict (slug) do update set title = excluded.title, summary = excluded.summary, cover_url = excluded.cover_url,
          tags = excluded.tags, access = excluded.access, price = excluded.price, preview_md = excluded.preview_md,
          status = excluded.status, published_at = excluded.published_at
        returning id into item_id;
        insert into public.article_bodies (article_id, content) values (item_id, p_payload->>'markdown')
          on conflict (article_id) do update set content = excluded.content;
        next_version := coalesce(latest.version, 0) + 1;
        insert into public.article_versions (article_id, version, content_hash, snapshot, client_request_id)
          values (item_id, next_version, p_payload->>'content_hash', p_payload->'snapshot', p_request_id);
        delete from public.article_chunks where article_id = item_id;
        insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
          values (item_id, parent.id, 'public', 'catalog', 0, (fm->>'title') || E'\n' || coalesce(fm->>'summary', ''), content_url);
        if fm->>'access' = 'public' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', case when parent.readme_article_id = item_id then 'readme' else 'body' end, 1, p_payload->>'markdown', content_url);
        elsif coalesce(p_payload->>'preview', '') <> '' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', 'preview', 1, p_payload->>'preview', content_url);
        end if;
      end if;
      result := jsonb_build_object('status', case when jsonb_array_length(diagnostics) > 0 then 'needs_user_action' else 'pass' end,
        'diagnostics', diagnostics, 'article', jsonb_build_object('slug', fm->>'slug', 'version', next_version,
          'url', content_url), 'revalidated', paths);
    end if;
  end if;
  insert into public.publish_requests (client_request_id, status, response) values (p_request_id, result->>'status', result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_content(p_kind text, p_id bigint, p_expected_updated_at timestamp with time zone, p_action text, p_value text, p_archive_notice boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  album public.series%rowtype;
  article public.articles%rowtype;
  old_status text;
  old_updated timestamptz;
  parent_id bigint;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '需要站主身份');
  end if;
  if p_kind = 'series' then
    select * into album from public.series where id = p_id for update;
    old_status := album.status; old_updated := album.updated_at;
  elsif p_kind = 'article' then
    select series_id into parent_id from public.articles where id = p_id;
    if parent_id is not null then
      select * into album from public.series where id = parent_id for update;
    end if;
    select * into article from public.articles where id = p_id for update;
    old_status := article.status; old_updated := article.updated_at;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的内容类型');
  end if;
  if old_status is null then
    return jsonb_build_object('ok', false, 'message', '内容不存在');
  end if;
  if p_expected_updated_at is null or old_updated <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'message', '内容已更新，请刷新后重试');
  end if;
  if old_status = 'archived' then
    return jsonb_build_object('ok', false, 'message', '归档内容不可修改或恢复');
  end if;
  if p_action = 'featured' then
    if p_value is null or p_value not in ('true','false') then
      return jsonb_build_object('ok',false,'message','置顶参数无效');
    end if;
    if p_kind = 'series' then update public.series set featured = p_value::boolean where id=p_id;
    else update public.articles set featured = p_value::boolean where id=p_id; end if;
  elsif p_action = 'price' and p_kind = 'series' then
    if album.type = 'event' then return jsonb_build_object('ok',false,'message','活动票价请在活动详情中修改'); end if;
    if p_value is null or p_value !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then return jsonb_build_object('ok',false,'message','价格需为 0–999999.99，最多两位小数'); end if;
    update public.series set price=p_value::numeric where id=p_id;
  elsif p_action = 'readme' and p_kind = 'series' then
    select * into article from public.articles where slug = p_value for update;
    if article.id is null or article.series_id is distinct from album.id
      or article.access <> 'public' or article.status not in ('published', 'paused') then
      return jsonb_build_object('ok', false, 'message', 'README 必须是本专辑已发布的公开章节');
    end if;
    update public.series set readme_article_id = article.id where id = p_id;
  elsif p_action = 'status' then
    if not ((old_status = 'published' and p_value = 'paused')
      or (old_status = 'paused' and p_value in ('published', 'archived'))
      or (p_kind = 'series' and old_status = 'draft' and p_value = 'published')) or p_value is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态变更；文章草稿请通过发布工作台发布');
    end if;
    if p_value = 'archived' then
      -- 归档静默（停售时已邮件通知）；时间闸：停售满 3 个月（权益保留期）才可归档。
      if p_archive_notice is distinct from true then
        return jsonb_build_object('ok', false, 'message', '请勾选确认归档');
      end if;
      if (case when p_kind = 'series' then album.paused_at else article.paused_at end) is null
         or (case when p_kind = 'series' then album.paused_at else article.paused_at end) > now() - interval '3 months' then
        return jsonb_build_object('ok', false, 'message', '停售满 3 个月后才可归档（已购权益保留期）');
      end if;
    end if;
    if p_kind = 'series' then
      if p_value = 'published' then
        select * into article from public.articles where id = album.readme_article_id for update;
        if article.id is null or article.series_id is distinct from album.id
          or article.access <> 'public' or article.status not in ('published', 'paused') then
          return jsonb_build_object('ok', false, 'message', '请先设置本专辑已发布的公开 README');
        end if;
        if album.type = 'event' and not exists(select 1 from public.event_details where series_id = album.id) then
          return jsonb_build_object('ok', false, 'message', '请先保存活动详情与票价');
        end if;
      end if;
      update public.series set status = p_value,
        paused_at = case p_value when 'paused' then now() when 'published' then null else paused_at end
      where id = p_id;
    else
      if p_value = 'archived' and album.readme_article_id = article.id and album.status <> 'archived' then
        return jsonb_build_object('ok', false, 'message', '此章节是专辑 README，请先更换 README 或归档专辑');
      end if;
      if p_value = 'published' and album.status = 'archived' then
        return jsonb_build_object('ok', false, 'message', '所属专辑已归档，不能恢复章节');
      end if;
      update public.articles set status = p_value,
        paused_at = case p_value when 'paused' then now() when 'published' then null else paused_at end
      where id = p_id;
    end if;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的操作');
  end if;
  return jsonb_build_object('ok', true, 'message', '已保存');
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_event_details(p_id bigint, p_expected_updated_at timestamp with time zone, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare album public.series%rowtype; previous public.event_details%rowtype; next_state text; price_text text; event_time timestamptz;
begin
  if not public.is_owner() then return jsonb_build_object('ok',false,'message','需要站主身份'); end if;
  select * into album from public.series where id=p_id for update;
  if album.id is null or album.type <> 'event' or album.status='archived' then return jsonb_build_object('ok',false,'message','仅可修改未归档的活动'); end if;
  if p_expected_updated_at is null or album.updated_at<>p_expected_updated_at then return jsonb_build_object('ok',false,'message','内容已更新，请刷新后重试'); end if;
  select * into previous from public.event_details where series_id=p_id for update;
  next_state := p_details->>'state'; price_text := p_details->>'ticket_price';
  if next_state is null or next_state not in ('upcoming','registering','ended') or coalesce(p_details->>'kind','') not in ('open','member')
    or price_text is null or price_text !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$'
    or length(coalesce(p_details->>'location_text',''))>500 or length(coalesce(p_details->>'registration',''))>3000 or length(coalesce(p_details->>'capacity',''))>200 then
    return jsonb_build_object('ok',false,'message','活动字段无效，请检查状态、票价和文字长度');
  end if;
  if (previous.series_id is null and next_state<>'upcoming') or (previous.series_id is not null and not (previous.state=next_state or (previous.state='upcoming' and next_state='registering') or (previous.state='registering' and next_state='ended'))) then
    return jsonb_build_object('ok',false,'message','活动按 即将开始 → 报名中 → 已结束 流转，不可倒退');
  end if;
  begin event_time := (p_details->>'starts_at')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'message','请输入有效活动时间'); end;
  if event_time is null or not isfinite(event_time) then return jsonb_build_object('ok',false,'message','请输入有效活动时间'); end if;
  insert into public.event_details(series_id,starts_at,location_text,registration,capacity,kind,ticket_price,state)
    values(p_id,event_time,nullif(p_details->>'location_text',''),nullif(p_details->>'registration',''),nullif(p_details->>'capacity',''),p_details->>'kind',price_text::numeric,next_state)
    on conflict(series_id) do update set starts_at=excluded.starts_at,location_text=excluded.location_text,registration=excluded.registration,capacity=excluded.capacity,kind=excluded.kind,ticket_price=excluded.ticket_price,state=excluded.state;
  update public.series set updated_at=now() where id=p_id;
  return jsonb_build_object('ok',true,'message','活动详情已保存');
end;
$function$;

CREATE OR REPLACE FUNCTION public.stage_content_file(p_scope text, p_path text, p_slug text, p_hash text, p_snapshot jsonb, p_expected bigint, p_request text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end $function$;

update public.app_schema_version set version='20261015163748' where id=1;
notify pgrst, 'reload schema';
commit;
