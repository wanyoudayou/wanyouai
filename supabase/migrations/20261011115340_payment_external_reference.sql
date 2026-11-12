-- A merchant account may outlive a database or be reused by another OPC instance.
-- Existing pending orders may already have been sent to the provider under their numeric
-- local ID. Reconcile those orders before upgrading; never silently rename one.
begin;

-- Freeze order creation/settlement before checking the legacy payment queue.
-- Without this lock, an old checkout could insert a pending row after the guard.
lock table public.orders in access exclusive mode;

do $guard$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20261010053221') then
    raise exception 'PAYMENT_REFERENCE_REQUIRES_20261010053221';
  end if;
  if exists(select 1 from public.orders where status='pending') then
    raise exception 'PAYMENT_REFERENCE_PENDING_ORDERS_REQUIRE_RECONCILIATION';
  end if;
end $guard$;

-- gen_random_uuid is a cryptographic random source. Mapping its nibbles to decimal
-- yields a 32-digit provider-compatible reference with ~97 bits of entropy. The
-- leading 9 prevents leading-zero normalization by payment intermediaries.
create function public.new_merchant_order_no() returns text language sql volatile set search_path='' as $$
  select '9' || substr(translate(replace(pg_catalog.gen_random_uuid()::text,'-',''),'abcdef','012345'),1,31)
$$;
revoke all on function public.new_merchant_order_no() from public,anon,authenticated;
grant execute on function public.new_merchant_order_no() to service_role;

-- Preserve the exact number submitted to the provider by the old application.
-- Only orders created after this migration receive a random reference.
alter table public.orders add column merchant_order_no text;
update public.orders set merchant_order_no=id::text;
alter table public.orders alter column merchant_order_no set default public.new_merchant_order_no();
alter table public.orders alter column merchant_order_no set not null;
alter table public.orders add constraint orders_merchant_order_no_format
  check (merchant_order_no ~ '^9[0-9]{31}$'
    or (merchant_order_no=id::text and status<>'pending'));
alter table public.orders add constraint orders_merchant_order_no_unique unique (merchant_order_no);

-- The reference is looked up in the same transaction that opens rights. Keep the
-- existing settlement lock order (trade advisory lock, then order row lock).
-- This RPC is service-role only. Legacy numeric callbacks never resolve to a new order.
create function public.settle_payment_reference(
  p_merchant_order_no text,p_event_id text,p_amount numeric,p_payload jsonb
) returns text language plpgsql set search_path='' as $$
declare v_order_id bigint;
begin
  if p_merchant_order_no is null or p_merchant_order_no !~ '^9[0-9]{31}$'
    or p_payload is null or p_payload->>'out_trade_no' is distinct from p_merchant_order_no then
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;
  select id into v_order_id from public.orders
    where merchant_order_no=p_merchant_order_no and provider='zpay';
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return public.settle_payment_queued(v_order_id,p_event_id,p_amount,p_payload);
end $$;
revoke all on function public.settle_payment_reference(text,text,numeric,jsonb)
  from public,anon,authenticated;
grant execute on function public.settle_payment_reference(text,text,numeric,jsonb)
  to service_role;

update public.app_schema_version set version='20261011115340' where id=1;
commit;
