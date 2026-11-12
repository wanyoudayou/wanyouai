begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$ begin
  if (select version from public.app_schema_version where id=1) is distinct from '20261011144257' then
    raise exception 'Expected application schema 20261011144257';
  end if;
end $guard$;

-- A claimed pending order is checked at most once per 30 minutes. This column
-- does not alter the payment state or the immutable merchant reference.
alter table public.orders add column reconcile_checked_at timestamptz;
create index idx_orders_pending_reconcile
  on public.orders (reconcile_checked_at asc nulls first, created_at, id)
  where status = 'pending';

-- The service role makes a short, atomic claim before contacting the provider.
-- SKIP LOCKED keeps concurrent cron invocations from claiming the same row.
create function public.claim_pending_payment_reconciliation()
returns table(id bigint, merchant_order_no text, user_id uuid, sku_type text,
              target_id bigint, amount numeric, status text)
language sql volatile security invoker set search_path = '' as $fn$
  with eligible as materialized (
    select o.id from public.orders o
    where o.status = 'pending'
      and o.created_at <= pg_catalog.now() - interval '10 minutes'
      and (o.reconcile_checked_at is null
           or o.reconcile_checked_at <= pg_catalog.now() - interval '30 minutes')
    order by o.reconcile_checked_at asc nulls first, o.created_at, o.id
    limit 1 for update skip locked
  )
  update public.orders o set reconcile_checked_at = pg_catalog.clock_timestamp()
    from eligible e where o.id = e.id and o.status = 'pending'
  returning o.id, o.merchant_order_no, o.user_id, o.sku_type,
            o.target_id, o.amount, o.status
$fn$;
revoke all on function public.claim_pending_payment_reconciliation()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_pending_payment_reconciliation() to service_role;

update public.app_schema_version
  set version='20261013171232', applied_at=now() where id=1;
commit;
