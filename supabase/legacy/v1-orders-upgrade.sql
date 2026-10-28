-- Additive V1 服务订单深化（2026-09-24 站主裁定，借鉴 Fiverr/Upwork）：
-- 报价单实体化（quote_snapshot）/ 交付单实体化（delivery_snapshot）/ 客户验收与打回（client_respond_booking）。
-- 状态机新增回退边：delivered → in_progress（客户要求修改，可多次；修改意见入 revision_notes）。
-- 在 m2-bookings.sql 之后执行。

alter table public.bookings
  add column if not exists quote_snapshot jsonb,
  add column if not exists delivery_snapshot jsonb,
  add column if not exists revision_notes jsonb not null default '[]'::jsonb;

-- 收件箱新增 kind='booking_event'（客户订单动态通知站主；m2-inbox.sql 原约束仅 escalation/inquiry）
alter table public.inbox_items drop constraint if exists inbox_items_kind_check;
alter table public.inbox_items add constraint inbox_items_kind_check check (kind in ('escalation', 'inquiry', 'booking_event'));

-- manage_booking 扩展两个带内容的动作（保留原 status/book/milestone_* 动作不变）：
--   quote   ：inquiry → quoted，value = { price?: number, plan: string, delivery_date: date }，报价单一次性快照可重发（quoted 态可再次 quote 覆盖）。
--   deliver ：in_progress → delivered，value = { note: string, links?: string[] }。
create or replace function public.manage_booking(
  p_id bigint, p_expected_updated_at timestamptz, p_action text, p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_next text;
  v_allowed boolean;
  v_item jsonb;
  v_price numeric;
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
    -- 报价与交付必须带内容：quoted 只走 quote 动作，delivered 只走 deliver 动作；其余快转保留。
    v_allowed := (b.status = 'inquiry' and v_next = 'declined')
      or (b.status = 'quoted' and v_next = 'declined')
      or (b.status = 'booked' and v_next = 'in_progress')
      or (b.status = 'delivered' and v_next = 'accepted')
      or (b.status = 'delivered' and v_next = 'in_progress')
      or (b.status = 'accepted' and v_next = 'settled');
    if not v_allowed or v_next is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态流转（报价与交付请使用带内容的对应操作）');
    end if;
    update public.bookings set status = v_next, updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存');
  elsif p_action = 'quote' then
    -- 发送报价：inquiry → quoted；quoted 态可重发（覆盖上一版报价单）。
    if b.status not in ('inquiry', 'quoted') then
      return jsonb_build_object('ok', false, 'message', '当前状态不可报价');
    end if;
    if length(trim(coalesce(p_value->>'plan', ''))) < 10 then
      return jsonb_build_object('ok', false, 'message', '请填写方案要点（至少 10 字）');
    end if;
    if nullif(p_value->>'delivery_date', '') is null then
      return jsonb_build_object('ok', false, 'message', '请填写预计交付日期');
    end if;
    v_price := case when nullif(p_value->>'price', '') is not null then (p_value->>'price')::numeric else null end;
    if v_price is not null and (v_price < 0 or v_price > 99999999.99) then
      return jsonb_build_object('ok', false, 'message', '报价金额无效');
    end if;
    update public.bookings
      set status = 'quoted',
          quote_snapshot = jsonb_build_object('price', v_price, 'plan', left(trim(p_value->>'plan'), 2000),
            'delivery_date', (p_value->>'delivery_date')::date, 'quoted_at', now()),
          updated_at = now()
      where id = p_id;
    return jsonb_build_object('ok', true, 'message', '报价已发送，客户可在订单追踪页查看并接受。');
  elsif p_action = 'deliver' then
    -- 提交交付：in_progress → delivered，附交付说明与链接。
    if b.status <> 'in_progress' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可交付');
    end if;
    if length(trim(coalesce(p_value->>'note', ''))) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写交付说明（至少 5 字）');
    end if;
    update public.bookings
      set status = 'delivered',
          delivery_snapshot = jsonb_build_object('note', left(trim(p_value->>'note'), 2000),
            'links', coalesce(p_value->'links', '[]'::jsonb), 'delivered_at', now()),
          updated_at = now()
      where id = p_id;
    return jsonb_build_object('ok', true, 'message', '交付已提交，等待客户验收。');
  elsif p_action = 'book' then
    -- 成交登记：quoted（站主先行登记）或 booked（客户已接受报价，站主补登记）→ booked；
    -- 六要素快照一次性不可变；签约日期 + 里程碑计划同事务。
    if b.status not in ('quoted', 'booked') then
      return jsonb_build_object('ok', false, 'message', '请先发送报价，再做成交登记');
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
    if jsonb_array_length(coalesce(p_value->'milestones', '[]'::jsonb)) > 0 then
      -- 显式里程碑计划（向后兼容旧调用）
      for v_item in select value from jsonb_array_elements(p_value->'milestones') loop
        if length(trim(coalesce(v_item->>'title', ''))) > 0 then
          insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
          values (p_id, left(v_item->>'title', 200),
                  case when v_item->>'owner_party' in ('owner', 'client', 'third') then v_item->>'owner_party' else 'owner' end,
                  nullif(v_item->>'expected_at', '')::date,
                  coalesce((v_item->>'sort')::int, 0));
        end if;
      end loop;
    elsif not exists (select 1 from public.milestones where booking_id = p_id) then
      -- 默认：按服务交付清单自动创建检查点（单一数据源，2026-09-24 裁定）
      insert into public.milestones (booking_id, title, owner_party, sort)
        select p_id, left(d.item, 200), 'owner', d.ord - 1
        from public.services s, unnest(s.deliverables) with ordinality d(item, ord)
        where s.id = b.service_id;
    end if;
    return jsonb_build_object('ok', true, 'message', '成交已登记，里程碑已按交付清单创建，客户现在可以看到订单追踪。');
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

-- 客户侧响应（SECURITY DEFINER：当事人校验在函数内；RLS 不动）。
-- accept_quote      ：quoted → booked（客户确认即成单，2026-09-24 裁定）
-- decline_quote     ：quoted → declined（可附原因）
-- accept_delivery   ：delivered → accepted
-- request_revision  ：delivered → in_progress，修改意见入 revision_notes（可多次）
-- 每次动作落 inbox_items（kind='booking_event'）通知站主。
create or replace function public.client_respond_booking(
  p_id bigint, p_action text, p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_uid uuid := auth.uid();
  v_note text;
  v_label text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', '请先登录');
  end if;
  select * into b from public.bookings where id = p_id for update;
  if b.id is null or b.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'message', '订单不存在');
  end if;

  if p_action = 'accept_quote' then
    if b.status <> 'quoted' or b.quote_snapshot is null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可接受报价');
    end if;
    update public.bookings set status = 'booked', updated_at = now() where id = p_id;
    v_label := '客户已接受报价，订单成交';
  elsif p_action = 'decline_quote' then
    if b.status <> 'quoted' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可谢绝报价');
    end if;
    update public.bookings set status = 'declined', updated_at = now() where id = p_id;
    v_label := '客户谢绝了报价';
  elsif p_action = 'accept_delivery' then
    if b.status <> 'delivered' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可验收');
    end if;
    update public.bookings set status = 'accepted', updated_at = now() where id = p_id;
    v_label := '客户已验收交付';
  elsif p_action = 'request_revision' then
    if b.status <> 'delivered' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可要求修改');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写修改意见（至少 5 字）');
    end if;
    update public.bookings
      set status = 'in_progress',
          revision_notes = revision_notes || jsonb_build_object('note', v_note, 'at', now()),
          updated_at = now()
      where id = p_id;
    v_label := '客户要求修改：' || v_note;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的操作');
  end if;

  insert into public.inbox_items (kind, user_id, contact, payload)
    values ('booking_event', v_uid, b.email,
      jsonb_build_object('message', v_label, 'booking_id', b.id, 'action', p_action));
  return jsonb_build_object('ok', true, 'message', '已提交');
end $$;

revoke all on function public.client_respond_booking(bigint, text, jsonb) from public, anon;
grant execute on function public.client_respond_booking(bigint, text, jsonb) to authenticated;
