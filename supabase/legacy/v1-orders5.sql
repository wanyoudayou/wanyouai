-- Additive V1 订单甬道批 4（2026-09-25 站主裁定）：节点级客户验收。
-- 站主「节点交付」后球到客户侧：客户「确认验收」（accepted_at）或「驳回」（意见必填，节点退回进行中）。
-- 不作卡点：节点验收不阻塞整单交付与验收；验收状态双方可见。
-- 在 v1-orders4.sql 之后执行。

alter table public.milestones
  add column if not exists accepted_at timestamptz,
  add column if not exists objection_note text,
  add column if not exists objected_at timestamptz;

-- manage_booking：milestone_deliver 重置验收态（重新交付即重新待验收，清掉旧驳回）。
create or replace function public.manage_booking(
  p_id bigint, p_expected_updated_at timestamptz, p_action text, p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_ms public.milestones%rowtype;
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
      select 1 from (values ('party_owner'), ('party_client'), ('scope'), ('deliverable'), ('cadence'), ('compensation'), ('exit'), ('ownership')) keys(k)
      where length(trim(coalesce(p_value->'agreement'->>keys.k, ''))) = 0
    ) then
      return jsonb_build_object('ok', false, 'message', '条款需完整填写（双方主体/范围/交付/节奏/酬劳/退出/归属）');
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
    update public.milestones set
      actual_at = case when p_value ? 'actual_at' then nullif(p_value->>'actual_at', '')::date else actual_at end,
      owner_party = case when p_value->>'owner_party' in ('owner', 'client') then p_value->>'owner_party' else owner_party end,
      expected_at = case when p_value ? 'expected_at' then nullif(p_value->>'expected_at', '')::date else expected_at end
    where id = (p_value->>'id')::bigint and booking_id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存检查点');
  elsif p_action = 'milestone_start' then
    select * into v_ms from public.milestones where id = (p_value->>'id')::bigint and booking_id = p_id;
    if v_ms.id is null then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    if v_ms.status <> 'todo' then
      return jsonb_build_object('ok', false, 'message', '仅未开始的检查点可以启动');
    end if;
    if nullif(p_value->>'expected_at', '') is null then
      return jsonb_build_object('ok', false, 'message', '请填写预计完成日期');
    end if;
    update public.milestones set status = 'doing', expected_at = (p_value->>'expected_at')::date, owner_party = 'owner' where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '检查点已启动');
  elsif p_action = 'milestone_deliver' then
    -- 节点交付：doing（含等待客户反馈中强制）→ done；交付说明必填；重置验收态待客户验收。
    select * into v_ms from public.milestones where id = (p_value->>'id')::bigint and booking_id = p_id;
    if v_ms.id is null then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    if v_ms.status <> 'doing' then
      return jsonb_build_object('ok', false, 'message', '仅进行中的检查点可以交付');
    end if;
    if length(trim(coalesce(p_value->>'note', ''))) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写节点交付说明（至少 5 字）');
    end if;
    update public.milestones set
      status = 'done',
      actual_at = coalesce(actual_at, current_date),
      completion_note = left(trim(p_value->>'note'), 1000),
      accepted_at = null,
      objection_note = null,
      objected_at = null,
      owner_party = 'client'
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '节点已交付，等待客户验收。');
  elsif p_action = 'milestone_request' then
    if b.status not in ('booked', 'in_progress') then
      return jsonb_build_object('ok', false, 'message', '当前状态不可发请求');
    end if;
    select * into v_ms from public.milestones where id = (p_value->>'id')::bigint and booking_id = p_id;
    if v_ms.id is null then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    if v_ms.status <> 'doing' then
      return jsonb_build_object('ok', false, 'message', '请先启动检查点，再向客户请求支持');
    end if;
    if length(trim(coalesce(p_value->>'note', ''))) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写需求说明（至少 5 字）');
    end if;
    update public.milestones set
      client_request = left(trim(p_value->>'note'), 1000),
      client_requested_at = now(),
      client_response = null,
      client_responded_at = null,
      owner_party = 'client'
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '请求已发送给客户');
  end if;
  return jsonb_build_object('ok', false, 'message', '不支持的操作');
end $$;

-- client_respond_booking：新增节点验收（accept_milestone）与驳回（object_milestone，意见必填，节点退回进行中）。
create or replace function public.client_respond_booking(
  p_id bigint, p_action text, p_value jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings%rowtype;
  v_uid uuid := auth.uid();
  v_note text;
  v_label text;
  v_ms public.milestones%rowtype;
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
    if b.status <> 'booked' or b.agreement_sent_at is null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可确认条款');
    end if;
    update public.bookings set agreement_confirmed_at = now(), updated_at = now() where id = p_id;
    v_label := '客户已确认条款，可以开工';
  elsif p_action = 'object_agreement' then
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
  elsif p_action = 'respond_milestone' then
    select * into v_ms from public.milestones where id = (p_value->>'milestone_id')::bigint and booking_id = p_id;
    if v_ms.id is null or v_ms.client_request is null then
      return jsonb_build_object('ok', false, 'message', '该检查点没有待反馈的请求');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 1 then
      return jsonb_build_object('ok', false, 'message', '请填写反馈内容');
    end if;
    update public.milestones set
      client_response = v_note,
      client_responded_at = now(),
      owner_party = 'owner'
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    v_label := '客户反馈了检查点「' || v_ms.title || '」：' || v_note;
  elsif p_action = 'accept_milestone' then
    -- 节点验收：done 且未验收 → 确认；球回站主侧。
    select * into v_ms from public.milestones where id = (p_value->>'milestone_id')::bigint and booking_id = p_id;
    if v_ms.id is null or v_ms.status <> 'done' or v_ms.accepted_at is not null then
      return jsonb_build_object('ok', false, 'message', '该检查点当前不可验收');
    end if;
    update public.milestones set accepted_at = now(), owner_party = 'owner' where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    v_label := '客户已验收检查点「' || v_ms.title || '」';
  elsif p_action = 'object_milestone' then
    -- 节点驳回：意见必填，节点退回进行中，球回站主侧。
    select * into v_ms from public.milestones where id = (p_value->>'milestone_id')::bigint and booking_id = p_id;
    if v_ms.id is null or v_ms.status <> 'done' or v_ms.accepted_at is not null then
      return jsonb_build_object('ok', false, 'message', '该检查点当前不可驳回');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写驳回意见（至少 5 字）');
    end if;
    update public.milestones set
      status = 'doing',
      objection_note = v_note,
      objected_at = now(),
      owner_party = 'owner'
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    v_label := '客户驳回了检查点「' || v_ms.title || '」：' || v_note;
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
