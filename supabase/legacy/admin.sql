-- Additive M0 owner lifecycle RPC. Apply after schema.sql / policies.sql.
create or replace function public.manage_content(
  p_kind text, p_id bigint, p_expected_updated_at timestamptz,
  p_action text, p_value text, p_archive_notice boolean default false
) returns jsonb language plpgsql security invoker set search_path = '' as $$
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
$$;
revoke all on function public.manage_content(text,bigint,timestamptz,text,text,boolean) from public, anon;
grant execute on function public.manage_content(text,bigint,timestamptz,text,text,boolean) to authenticated;


create or replace function public.save_event_details(p_id bigint, p_expected_updated_at timestamptz, p_details jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
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
$$;
revoke all on function public.save_event_details(bigint,timestamptz,jsonb) from public,anon;
grant execute on function public.save_event_details(bigint,timestamptz,jsonb) to authenticated;
