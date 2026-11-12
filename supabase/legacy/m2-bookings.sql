-- Additive M2-S6 fulfillment pipeline. Apply after m2-inbox.sql.
-- manage_booking：站主履约管道事务函数（SECURITY INVOKER + owner 校验，与 manage_content 同构）。
-- 表级授权 + owner policy 沿用内容表模式：RLS 做身份隔离，RPC 做状态机与快照语义。

create policy bookings_owner_update on public.bookings for update
  using (public.is_owner()) with check (public.is_owner());
create policy milestones_owner_write on public.milestones for all
  using (public.is_owner()) with check (public.is_owner());
grant update on public.bookings to authenticated;
grant select, insert, update, delete on public.milestones to authenticated;

create or replace function public.manage_booking(
  p_id bigint, p_expected_updated_at timestamptz, p_action text, p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_next text;
  v_allowed boolean;
  v_item jsonb;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '需要站主身份');
  end if;
  select * into b from public.bookings where id = p_id for update;
  if b.id is null then
    return jsonb_build_object('ok', false, 'message', '订单不存在');
  end if;
  if p_expected_updated_at is null or b.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'message', '订单已更新，请刷新后重试');
  end if;

  if p_action = 'status' then
    v_next := p_value->>'status';
    v_allowed := (b.status = 'inquiry' and v_next in ('quoted', 'declined'))
      or (b.status = 'quoted' and v_next = 'declined')
      or (b.status = 'booked' and v_next = 'in_progress')
      or (b.status = 'in_progress' and v_next = 'delivered')
      or (b.status = 'delivered' and v_next = 'accepted')
      or (b.status = 'accepted' and v_next = 'settled');
    if not v_allowed or v_next is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态流转');
    end if;
    update public.bookings set status = v_next, updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存');
  elsif p_action = 'book' then
    -- 成交登记：quoted → booked；六要素快照一次性不可变；签约日期 + 里程碑计划同事务。
    if b.status <> 'quoted' then
      return jsonb_build_object('ok', false, 'message', '请先标记报价，再做成交登记');
    end if;
    if b.agreement_snapshot is not null then
      return jsonb_build_object('ok', false, 'message', '协议快照已存在，不可修改');
    end if;
    if p_value->>'agreed_at' is null then
      return jsonb_build_object('ok', false, 'message', '请填写签约日期');
    end if;
    if exists (
      select 1 from (values ('scope'), ('deliverable'), ('cadence'), ('compensation'), ('exit'), ('ownership')) keys(k)
      where length(trim(coalesce(p_value->'agreement'->>keys.k, ''))) = 0
    ) then
      return jsonb_build_object('ok', false, 'message', '六要素协议需完整填写（范围/交付/节奏/酬劳/退出/归属）');
    end if;
    update public.bookings
      set status = 'booked', agreement_snapshot = p_value->'agreement',
          agreed_at = (p_value->>'agreed_at')::date, updated_at = now()
      where id = p_id;
    for v_item in select value from jsonb_array_elements(coalesce(p_value->'milestones', '[]'::jsonb)) loop
      if length(trim(coalesce(v_item->>'title', ''))) > 0 then
        insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
        values (p_id, left(v_item->>'title', 200),
                case when v_item->>'owner_party' in ('owner', 'client', 'third') then v_item->>'owner_party' else 'owner' end,
                nullif(v_item->>'expected_at', '')::date,
                coalesce((v_item->>'sort')::int, 0));
      end if;
    end loop;
    return jsonb_build_object('ok', true, 'message', '成交已登记，客户现在可以看到订单追踪。');
  elsif p_action = 'milestone_add' then
    if length(trim(coalesce(p_value->>'title', ''))) = 0 then
      return jsonb_build_object('ok', false, 'message', '请填写检查点名称');
    end if;
    insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
    values (p_id, left(p_value->>'title', 200),
            case when p_value->>'owner_party' in ('owner', 'client', 'third') then p_value->>'owner_party' else 'owner' end,
            nullif(p_value->>'expected_at', '')::date,
            coalesce((p_value->>'sort')::int, 0));
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已添加检查点');
  elsif p_action = 'milestone_update' then
    if p_value->>'status' is not null and p_value->>'status' not in ('todo', 'doing', 'done') then
      return jsonb_build_object('ok', false, 'message', '检查点状态无效');
    end if;
    update public.milestones set
      status = coalesce(nullif(p_value->>'status', ''), status),
      actual_at = case when p_value ? 'actual_at' then nullif(p_value->>'actual_at', '')::date else actual_at end,
      owner_party = case when p_value->>'owner_party' in ('owner', 'client', 'third') then p_value->>'owner_party' else owner_party end,
      expected_at = case when p_value ? 'expected_at' then nullif(p_value->>'expected_at', '')::date else expected_at end
    where id = (p_value->>'id')::bigint and booking_id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存检查点');
  end if;
  return jsonb_build_object('ok', false, 'message', '不支持的操作');
end $$;

revoke all on function public.manage_booking(bigint, timestamptz, text, jsonb) from public, anon;
grant execute on function public.manage_booking(bigint, timestamptz, text, jsonb) to authenticated;
