-- M1 payments. Run after schema.sql + policies.sql on fresh installs; apply once
-- as an incremental migration for existing deployments.
-- payment_events is the single inbox: the zpay notify callback and the reconcile
-- sweep both settle through this function and never bypass it. service_role only;
-- amount is checked against the order snapshot and duplicate event ids skip
-- idempotently inside the same transaction that grants the entitlement.

create or replace function public.settle_payment(p_order_id bigint, p_event_id text, p_amount numeric, p_payload jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_duplicate boolean;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'EMPTY_EVENT';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select exists (
    select 1 from public.payment_events where provider = 'zpay' and event_id = p_event_id
  ) into v_duplicate;
  if v_duplicate then
    -- Replay of an event we already settled (or deliberately skipped): no side effects.
    return 'duplicate';
  end if;

  if v_order.status = 'paid' then
    -- A different event paying an already-paid order: record it, never grant twice.
    insert into public.payment_events (provider, event_id, payload)
    values ('zpay', p_event_id, coalesce(p_payload, '{}'::jsonb));
    return 'already_paid';
  end if;

  if p_amount is null or p_amount <> v_order.amount then
    -- Amount mismatch is rejected before anything is recorded (no trace left).
    raise exception 'AMOUNT_MISMATCH';
  end if;

  insert into public.payment_events (provider, event_id, payload)
  values ('zpay', p_event_id, coalesce(p_payload, '{}'::jsonb));

  update public.orders set status = 'paid'
  where id = p_order_id and status = 'pending';

  if v_order.sku_type = 'subscription' then
    insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
    select v_order.user_id, 'subscription', null, now() + interval '1 year', 'order', 'order:' || v_order.id
    where not exists (
      select 1 from public.entitlements e
      where e.user_id = v_order.user_id and e.type = 'subscription' and e.target_id is null
        and e.revoked_at is null and (e.ends_at is null or e.ends_at > now())
    );
  else
    insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
    select v_order.user_id, v_order.sku_type, v_order.target_id, null, 'order', 'order:' || v_order.id
    where not exists (
      select 1 from public.entitlements e
      where e.user_id = v_order.user_id and e.type = v_order.sku_type
        and e.target_id is not distinct from v_order.target_id
        and e.revoked_at is null and (e.ends_at is null or e.ends_at > now())
    );
  end if;

  return 'settled';
end $$;

-- Only the server-side payment path may settle; clients never call this directly.
revoke all on function public.settle_payment(bigint, text, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.settle_payment(bigint, text, numeric, jsonb) to service_role;
