begin;
-- Event registration is one database authority: eligibility, capacity and the
-- registration row are decided under the event row lock. Paid ticket holders
-- keep their right to register when the event is paused or full.

create function public.event_capacity_limit(p_capacity text)
returns integer language sql immutable set search_path='' as $$
  select nullif(substring(coalesce(p_capacity,'') from '^\s*([0-9]{1,6})'),'')::integer
$$;
revoke all on function public.event_capacity_limit(text) from public,anon,authenticated,service_role;
grant execute on function public.event_capacity_limit(text) to service_role;

-- Seats already promised: registered rows plus valid tickets whose holder has not registered yet.
create function public.event_committed_seats(p_series bigint)
returns integer language sql stable set search_path='' as $$
  select (select count(*) from public.registrations r where r.series_id=p_series and r.status='registered')::integer
    + (select count(distinct e.user_id) from public.entitlements e
        where e.type='event' and e.target_id=p_series and e.revoked_at is null
          and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())
          and not exists(select 1 from public.registrations r
            where r.series_id=p_series and r.user_id=e.user_id and r.status='registered'))::integer
$$;
revoke all on function public.event_committed_seats(bigint) from public,anon,authenticated,service_role;
grant execute on function public.event_committed_seats(bigint) to service_role;

create function public.register_for_event(p_series bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  s public.series%rowtype;
  d public.event_details%rowtype;
  v_ticket boolean;
  v_subscribed boolean;
  v_reason text;
  v_limit integer;
  v_existing public.registrations%rowtype;
  v_row public.registrations%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok',false,'code','LOGIN_REQUIRED','message','报名需登录（注册即可）。');
  end if;
  if p_series is null or p_series<=0 then
    return jsonb_build_object('ok',false,'code','NOT_FOUND','message','活动不存在');
  end if;
  select * into s from public.series where id=p_series and type='event';
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','活动不存在'); end if;
  -- Serializes with ticket sales (create_pending_order holds FOR SHARE) and other registrations.
  select * into d from public.event_details where series_id=p_series for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND','message','活动详情未配置'); end if;
  select email into v_email from auth.users where id=v_user;
  if v_email is null or btrim(v_email)='' then
    return jsonb_build_object('ok',false,'code','EMAIL_REQUIRED','message','暂时无法获取账户邮箱，请稍后再试。');
  end if;

  v_ticket := exists(select 1 from public.entitlements e where e.user_id=v_user and e.type='event' and e.target_id=p_series
    and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now()));
  v_subscribed := exists(select 1 from public.entitlements e where e.user_id=v_user and e.type='subscription'
    and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now()));

  -- A ticket survives pause (stop selling, keep serving); only archive or end closes it.
  if s.status not in ('published','paused') or (s.status='paused' and not v_ticket) then
    return jsonb_build_object('ok',false,'code','CLOSED','message','暂不可报名：活动未上架');
  end if;
  if d.state='ended' then return jsonb_build_object('ok',false,'code','CLOSED','message','暂不可报名：活动已结束'); end if;
  if d.state<>'registering' then return jsonb_build_object('ok',false,'code','CLOSED','message','暂不可报名：报名未开始'); end if;

  if not v_ticket then
    if d.kind='member' and not v_subscribed then
      if coalesce(d.ticket_price,0)>0 then
        return jsonb_build_object('ok',false,'code','TICKET_REQUIRED','status','ticket_required','price',d.ticket_price,'message','本活动需购票后报名。');
      end if;
      return jsonb_build_object('ok',false,'code','SUBSCRIPTION_REQUIRED','status','subscription_required','message','本活动为会员专享，订阅后即可免费报名。');
    end if;
    if d.kind<>'member' and coalesce(d.ticket_price,0)>0 then
      return jsonb_build_object('ok',false,'code','TICKET_REQUIRED','status','ticket_required','price',d.ticket_price,'message','本活动需购票后报名。');
    end if;
  end if;

  select * into v_existing from public.registrations where series_id=p_series and email=v_email;
  if found and v_existing.status<>'cancelled' then
    return jsonb_build_object('ok',true,'status',v_existing.status,'checkin_token',v_existing.checkin_token,'message','你已报名本活动。');
  end if;

  -- Ticket holders already hold a counted seat; capacity limits free and member registrations.
  v_limit := public.event_capacity_limit(d.capacity);
  if not v_ticket and v_limit is not null and v_limit>0 and public.event_committed_seats(p_series)>=v_limit then
    return jsonb_build_object('ok',false,'code','FULL','message','名额已满，感谢关注。');
  end if;

  insert into public.registrations(series_id,user_id,email)
  values(p_series,v_user,v_email)
  on conflict(series_id,email) do update set status='registered',user_id=coalesce(public.registrations.user_id,excluded.user_id)
  returning * into v_row;
  v_reason := case when v_existing.id is not null then '已恢复报名。' else '报名成功。' end;
  return jsonb_build_object('ok',true,'status',v_row.status,'checkin_token',v_row.checkin_token,'message',v_reason);
end $$;
revoke all on function public.register_for_event(bigint) from public,anon,authenticated,service_role;
grant execute on function public.register_for_event(bigint) to authenticated;

-- Ticket sales stop once every seat is committed; price authority is unchanged.
create or replace function public.create_pending_order(p_user_id uuid, p_sku text, p_target bigint, p_amount numeric)
 returns jsonb
 language plpgsql
 set search_path to ''
as $function$
declare v_price numeric; v_order public.orders%rowtype; v_capacity text;
begin
  -- Revalidate the server price snapshot while holding a shared product/configuration lock.
  if p_sku='subscription' and p_target is null then
    select (commerce->'subscription_price'->>'amount')::numeric into v_price from public.site_config where id=1 for share;
  elsif p_sku='series' then
    select price into v_price from public.series where id=p_target and type in ('collection','handbook','skill') and status='published'
      and not exists(select 1 from public.skills k where k.legacy_series_id=series.id) for share;
  elsif p_sku='skill' then
    select k.price into v_price from public.skills k join public.articles a on a.id=k.id
      where k.id=p_target and a.type='skill' and a.status='published' and k.current_release is not null for share of k,a;
  elsif p_sku='single' then
    select price into v_price from public.articles where id=p_target and type='blog' and series_id is null and access='paid' and status='published' for share;
  elsif p_sku='event' then
    select d.ticket_price,d.capacity into v_price,v_capacity from public.event_details d join public.series s on s.id=d.series_id
      where s.id=p_target and s.type='event' and s.status='published' and d.state in ('upcoming','registering') for share of s,d;
    if v_price is not null and coalesce(public.event_capacity_limit(v_capacity),0)>0
      and public.event_committed_seats(p_target)>=public.event_capacity_limit(v_capacity) then
      raise exception 'NOT_SELLABLE';
    end if;
  end if;
  if v_price is null or v_price<=0 or p_amount is null or p_amount<>v_price then raise exception 'NOT_SELLABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || p_user_id::text || ':' || p_sku || ':' || coalesce(p_target::text,''),0));
  if (p_sku='skill' and public.can_use_skill(p_target,p_user_id)) or exists(select 1 from public.entitlements e where e.user_id=p_user_id and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
    and (e.type='subscription' or (e.type=p_sku and e.target_id is not distinct from p_target))) then raise exception 'ALREADY_ENTITLED'; end if;
  select * into v_order from public.orders where user_id=p_user_id and sku_type=p_sku
    and target_id is not distinct from p_target and amount=v_price and status='pending' and provider='zpay'
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_order); end if;
  insert into public.orders(user_id,sku_type,target_id,amount) values(p_user_id,p_sku,p_target,v_price) returning * into v_order;
  return to_jsonb(v_order);
end $function$;
revoke all on function public.create_pending_order(uuid,text,bigint,numeric) from public,anon,authenticated,service_role;
grant execute on function public.create_pending_order(uuid,text,bigint,numeric) to service_role;

update public.app_schema_version set version='20261111000000' where id=1;
notify pgrst,'reload schema';
commit;
