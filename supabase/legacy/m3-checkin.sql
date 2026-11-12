-- Additive M3-S3 check-in. Apply after m2-bookings.sql.
-- ① checkin_registration：站主核销（token 即凭证）；免费活动到场发 checkin 永久票（幂等）。
-- ② handle_new_user 扩展：纯邮箱报名者首登时绑定 user_id，并补发到场的免费活动票。

create or replace function public.checkin_registration(p_token uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  r public.registrations%rowtype;
  ev record;
  granted boolean := false;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '核销仅限站主操作');
  end if;
  select * into r from public.registrations where checkin_token = p_token for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'message', '核销链接无效');
  end if;
  if r.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'message', '该报名已取消');
  end if;
  if r.status = 'attended' then
    return jsonb_build_object('ok', true, 'message', '此前已核销', 'status', 'attended', 'granted', false);
  end if;
  update public.registrations set status = 'attended' where id = r.id;

  -- 免费活动：到场即发票（付费活动票随订单发放，此处不重复）；已有票/订阅者不重复发
  select ed.ticket_price into ev from public.event_details ed where ed.series_id = r.series_id;
  if r.user_id is not null and coalesce(ev.ticket_price, 0) <= 0 then
    insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
    select r.user_id, 'event', r.series_id, null, 'checkin', 'checkin:' || r.id
    where not exists (
      select 1 from public.entitlements e
      where e.user_id = r.user_id and e.type = 'event' and e.target_id = r.series_id
        and e.revoked_at is null and (e.ends_at is null or e.ends_at > now())
    );
    granted := found;
  end if;
  return jsonb_build_object('ok', true, 'message', case when granted then '已核销，纪要权限已开通' else '已核销' end, 'status', 'attended', 'granted', granted);
end $$;

-- RPC 以 owner 身份（authenticated）运行，所需表权限：
create policy registrations_owner_update on public.registrations for update
  using (public.is_owner()) with check (public.is_owner());
grant update on public.registrations to authenticated;
create policy entitlements_owner_insert on public.entitlements for insert
  with check (public.is_owner());
grant insert on public.entitlements to authenticated;

revoke all on function public.checkin_registration(uuid) from public, anon;
grant execute on function public.checkin_registration(uuid) to authenticated, service_role;

-- 纯邮箱报名者首登补发：绑定 user_id + 补发到场的免费活动票
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  for r in
    select reg.id, reg.series_id from public.registrations reg
    where reg.user_id is null and lower(reg.email) = lower(new.email)
  loop
    update public.registrations set user_id = new.id where id = r.id;
    if r.series_id is not null then
      insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
      select new.id, 'event', r.series_id, null, 'checkin', 'checkin:' || r.id
      where r.id in (select id from public.registrations where status = 'attended')
        and coalesce((select ed.ticket_price from public.event_details ed where ed.series_id = r.series_id), 0) <= 0
        and not exists (
          select 1 from public.entitlements e
          where e.user_id = new.id and e.type = 'event' and e.target_id = r.series_id and e.revoked_at is null
        );
    end if;
  end loop;
  return new;
end $$;
