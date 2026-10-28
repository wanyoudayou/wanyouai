-- Additive V1 订单甬道批 1（2026-09-25 站主裁定）：
-- ① 条款生命周期：草拟（可编辑）→ 发送客户确认（锁定）→ 客户同意（不可变，开工解锁）；客户异议退回草拟。
-- ② 开工以条款确认为闸（booked → in_progress 需 agreement_confirmed_at）。
-- ③ 里程碑「已完成」自动写实际日期=当天。
-- 在 v1-orders-upgrade.sql 之后执行。

alter table public.bookings
  add column if not exists agreement_sent_at timestamptz,
  add column if not exists agreement_confirmed_at timestamptz;

-- manage_booking：book 改为条款草稿保存（可反复编辑，直至发送）；新增 send_agreement；开工闸收紧。
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
    v_allowed := (b.status = 'inquiry' and v_next = 'declined')
      or (b.status = 'quoted' and v_next = 'declined')
      or (b.status = 'delivered' and v_next = 'accepted')
      or (b.status = 'delivered' and v_next = 'in_progress')
      or (b.status = 'accepted' and v_next = 'settled');
    -- 开工闸：条款经客户确认才能开工（2026-09-25 裁定）
    if b.status = 'booked' and v_next = 'in_progress' then
      if b.agreement_confirmed_at is null then
        return jsonb_build_object('ok', false, 'message', '条款尚未经客户确认，不能开工');
      end if;
      v_allowed := true;
    end if;
    if not v_allowed or v_next is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态流转（报价与交付请使用带内容的对应操作）');
    end if;
    update public.bookings set status = v_next, updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存');
  elsif p_action = 'quote' then
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
    -- 条款草稿：quoted/booked 且未发送未确认时可反复保存；quoted 首存即 booked（站主先行路径）。
    if b.status not in ('quoted', 'booked') then
      return jsonb_build_object('ok', false, 'message', '请先发送报价，再编辑条款');
    end if;
    if b.agreement_sent_at is not null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '条款已发送客户确认，不可再改（客户异议会退回草拟）');
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
      for v_item in select value from jsonb_array_elements(p_value->'milestones') loop
        if length(trim(coalesce(v_item->>'title', ''))) > 0 then
          insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
          values (p_id, left(v_item->>'title', 200),
                  case when v_item->>'owner_party' in ('owner', 'client') then v_item->>'owner_party' else 'owner' end,
                  nullif(v_item->>'expected_at', '')::date,
                  coalesce((v_item->>'sort')::int, 0));
        end if;
      end loop;
    elsif not exists (select 1 from public.milestones where booking_id = p_id) then
      insert into public.milestones (booking_id, title, owner_party, sort)
        select p_id, left(d.item, 200), 'owner', d.ord - 1
        from public.services s, unnest(s.deliverables) with ordinality d(item, ord)
        where s.id = b.service_id;
    end if;
    return jsonb_build_object('ok', true, 'message', '条款草稿已保存；发送给客户确认后才能开工。');
  elsif p_action = 'send_agreement' then
    -- 发送条款给客户确认：锁定编辑，等待客户同意或异议。
    if b.status <> 'booked' or b.agreement_snapshot is null then
      return jsonb_build_object('ok', false, 'message', '请先保存条款草稿');
    end if;
    if b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '条款已确认');
    end if;
    if b.agreement_sent_at is not null then
      return jsonb_build_object('ok', false, 'message', '条款已发送，等待客户确认');
    end if;
    update public.bookings set agreement_sent_at = now(), updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '条款已发送，等待客户确认。');
  elsif p_action = 'milestone_add' then
    if length(trim(coalesce(p_value->>'title', ''))) = 0 then
      return jsonb_build_object('ok', false, 'message', '请填写检查点名称');
    end if;
    insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
    values (p_id, left(p_value->>'title', 200),
            case when p_value->>'owner_party' in ('owner', 'client') then p_value->>'owner_party' else 'owner' end,
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
      -- 标记完成且未填实际日期时自动写当天（2026-09-25 裁定）
      actual_at = case
        when p_value ? 'actual_at' then nullif(p_value->>'actual_at', '')::date
        when p_value->>'status' = 'done' then coalesce(actual_at, current_date)
        else actual_at end,
      owner_party = case when p_value->>'owner_party' in ('owner', 'client') then p_value->>'owner_party' else owner_party end,
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

-- client_respond_booking：新增条款确认与异议。
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
  elsif p_action = 'accept_agreement' then
    -- 客户同意条款：条款锁定不可变，开工解锁。
    if b.status <> 'booked' or b.agreement_sent_at is null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可确认条款');
    end if;
    update public.bookings set agreement_confirmed_at = now(), updated_at = now() where id = p_id;
    v_label := '客户已确认条款，可以开工';
  elsif p_action = 'object_agreement' then
    -- 客户异议：条款退回草拟（站主可再编辑后重发）。
    if b.status <> 'booked' or b.agreement_sent_at is null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可提出异议');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写异议说明（至少 5 字）');
    end if;
    update public.bookings
      set agreement_sent_at = null,
          revision_notes = revision_notes || jsonb_build_object('note', '条款异议：' || v_note, 'at', now()),
          updated_at = now()
      where id = p_id;
    v_label := '客户对条款提出异议：' || v_note;
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
