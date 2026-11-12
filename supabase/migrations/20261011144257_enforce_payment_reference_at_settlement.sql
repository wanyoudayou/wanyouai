-- Close the old service-only numeric RPC path as well as the new public-facing path.
begin;
set local lock_timeout='5s';

do $guard$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20261011115340') then
    raise exception 'PAYMENT_REFERENCE_BINDING_REQUIRES_20261011115340';
  end if;
end $guard$;

create or replace function public.settle_payment(p_order_id bigint, p_event_id text, p_amount numeric, p_payload jsonb)
returns text language plpgsql set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_event public.payment_events%rowtype;
  v_trade text;
  v_bound text;
  v_duplicate boolean := false;
begin
  if p_event_id is null or btrim(p_event_id)='' or length(p_event_id)>256 then raise exception 'EMPTY_EVENT'; end if;
  if p_payload is not null and jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD'; end if;
  -- Normalize event aliases only after requiring the persisted merchant reference below.
  v_trade := coalesce(nullif(p_payload->>'trade_no',''), p_event_id);
  if length(v_trade)>256 then raise exception 'EMPTY_EVENT'; end if;
  -- Same provider transaction, even across different orders, is serialized before inspecting the inbox.
  perform pg_advisory_xact_lock(hashtextextended('zpay-event:' || v_trade, 0));
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.provider<>'zpay' then raise exception 'PROVIDER_MISMATCH'; end if;
  -- Validate under the order row lock in every entrypoint, including old RPCs.
  -- Old deployments send a local ID or no reference: both must fail closed.
  if v_order.merchant_order_no !~ '^9[0-9]{31}$'
    or p_payload is null
    or p_payload->>'out_trade_no' is distinct from v_order.merchant_order_no then
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;
  if p_amount is null or p_amount<=0 or p_amount<>v_order.amount then raise exception 'AMOUNT_MISMATCH'; end if;
  -- Only pending can open rights. Fulfilled/refunded/failed never re-enter settlement.
  if v_order.status not in ('pending','paid') then raise exception 'ORDER_NOT_PENDING'; end if;

  for v_event in select * from public.payment_events
    where provider='zpay' and (event_id=v_trade or payload->>'trade_no'=v_trade)
  loop
    v_bound := coalesce(
      v_event.payload->>'settlement_order_id',
      v_event.payload->>'out_trade_no',
      substring(v_event.event_id from '^(?:return|reconcile):([0-9]+):')
    );
    -- Unknown legacy bindings require operator reconciliation; do not guess or grant.
    if v_bound is null then raise exception 'EVENT_BINDING_REQUIRED'; end if;
    if v_bound<>p_order_id::text then raise exception 'EVENT_ORDER_MISMATCH'; end if;
    v_duplicate := true;
  end loop;
  if v_duplicate then
    if v_order.status<>'paid' then raise exception 'EVENT_BINDING_REQUIRED'; end if;
    return 'duplicate';
  end if;

  insert into public.payment_events(provider,event_id,payload)
  values('zpay',v_trade,coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('settlement_order_id',p_order_id::text,'trade_no',v_trade));
  if v_order.status='paid' then return 'already_paid'; end if;

  -- Different pending orders for one entitlement must also serialize their active-right check.
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || v_order.user_id::text || ':' || v_order.sku_type || ':' || coalesce(v_order.target_id::text,''), 0));
  update public.orders set status='paid' where id=p_order_id;
  insert into public.entitlements(user_id,type,target_id,ends_at,source,source_ref)
  select v_order.user_id,v_order.sku_type,v_order.target_id,
    case when v_order.sku_type='subscription' then now()+interval '1 year' else null end,
    'order','order:' || v_order.id
  where not exists (
    select 1 from public.entitlements e where e.user_id=v_order.user_id and e.type=v_order.sku_type
      and e.target_id is not distinct from v_order.target_id
      and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
  );
  return 'settled';
end $$;
revoke all on function public.settle_payment(bigint,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.settle_payment(bigint,text,numeric,jsonb) to service_role;

update public.app_schema_version set version='20261011144257' where id=1;
commit;
