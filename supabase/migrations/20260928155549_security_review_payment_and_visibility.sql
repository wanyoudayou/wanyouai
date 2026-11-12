-- Append-only release repair. No historical orders, events, conversations or content are rewritten.
begin;

do $$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20260928124423') then
    raise exception 'Unexpected application version; apply migrations in order';
  end if;
end $$;

-- Parent lifecycle applies to metadata and, through their article lookup, body/chunk RLS.
drop policy articles_read on public.articles;
create policy articles_read on public.articles for select to anon, authenticated
using (
  (select public.is_owner()) or (
    status in ('published','paused') and (
      (type='blog' and series_id is null) or
      (type='chapter' and exists (
        select 1 from public.series s where s.id=articles.series_id and s.status in ('published','paused')
      ))
    )
  )
);

-- The authenticated owner can edit tables directly through REST; retention must survive that path.
-- Trusted service/database maintenance roles retain repair/import authority.
create function public.guard_content_lifecycle() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  if old.status='archived' then raise exception 'ARCHIVED_CONTENT_IMMUTABLE'; end if;
  if new.status=old.status then
    if new.paused_at is distinct from old.paused_at then raise exception 'RETENTION_CLOCK_IMMUTABLE'; end if;
    return new;
  end if;
  if not ((old.status='draft' and new.status='published') or (old.status='published' and new.status='paused')
    or (old.status='paused' and new.status in ('published','archived'))) then raise exception 'INVALID_CONTENT_TRANSITION'; end if;
  if new.status='archived' then
    if old.paused_at is null or old.paused_at>now()-interval '3 months' then raise exception 'RETENTION_PERIOD'; end if;
    new.paused_at := old.paused_at;
  elsif new.status='paused' then
    new.paused_at := now();
  elsif new.status='published' then
    new.paused_at := null;
  end if;
  return new;
end $$;
revoke all on function public.guard_content_lifecycle() from public,anon,authenticated,service_role;
create trigger guard_content_lifecycle before update on public.articles for each row execute function public.guard_content_lifecycle();
create trigger guard_content_lifecycle before update on public.series for each row execute function public.guard_content_lifecycle();

-- The ask API owns conversation writes. Browser INSERT was unused and allowed post-review appends.
revoke insert on public.conversations, public.conversation_messages from anon, authenticated;
revoke usage, select on sequence public.conversations_id_seq, public.conversation_messages_id_seq from anon, authenticated;
drop policy conversations_own_insert on public.conversations;
drop policy conversation_messages_own_insert on public.conversation_messages;

-- Raw transcripts remain private even after moderation; public QA is an explicit editorial artifact.
alter policy conversations_own_read on public.conversations using (user_id=(select auth.uid()) or (select public.is_owner()));
alter policy conversation_messages_read on public.conversation_messages using (
  exists(select 1 from public.conversations c where c.id=conversation_id and (c.user_id=(select auth.uid()) or (select public.is_owner())))
);
create table public.conversation_publications (
  conversation_id bigint primary key references public.conversations(id) on delete cascade,
  article_id bigint references public.articles(id) on delete set null,
  question_md text not null check (length(btrim(question_md)) between 1 and 2000),
  answer_md text not null check (length(btrim(answer_md)) between 1 and 12000),
  updated_at timestamptz not null default now()
);
create index conversation_publications_article_idx on public.conversation_publications(article_id);
alter table public.conversation_publications enable row level security;
create policy publications_public_read on public.conversation_publications for select to anon, authenticated
using (article_id is null or exists(select 1 from public.articles a where a.id=article_id));
create policy publications_owner_all on public.conversation_publications for all to authenticated
using ((select public.is_owner())) with check ((select public.is_owner()));
-- Explicit grants override permissive hosted defaults for this newly introduced table.
revoke all on public.conversation_publications from public, anon, authenticated;
grant select on public.conversation_publications to anon, authenticated;
grant insert, update, delete on public.conversation_publications to authenticated;
grant all on public.conversation_publications to service_role;

create function public.review_conversation(p_id bigint, p_status text, p_question text, p_answer text, p_confirmed boolean)
returns void language plpgsql set search_path='' as $$
declare v_article bigint;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if p_status not in ('public','hidden') or p_status is null then raise exception 'INVALID_REVIEW'; end if;
  select article_id into v_article from public.conversations where id=p_id for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_status='public' then
    if p_confirmed is distinct from true then raise exception 'PUBLIC_COPY_CONFIRMATION_REQUIRED'; end if;
    insert into public.conversation_publications(conversation_id,article_id,question_md,answer_md)
    values(p_id,v_article,btrim(p_question),btrim(p_answer))
    on conflict(conversation_id) do update set question_md=excluded.question_md,answer_md=excluded.answer_md,updated_at=now();
  else
    delete from public.conversation_publications where conversation_id=p_id;
  end if;
  update public.conversations set status=p_status where id=p_id;
end $$;
revoke all on function public.review_conversation(bigint,text,text,text,boolean) from public, anon;
grant execute on function public.review_conversation(bigint,text,text,text,boolean) to authenticated;

-- Legacy query events used return:/reconcile: aliases; index their recorded provider trade number.
create index payment_events_trade_no_idx on public.payment_events(provider, (payload->>'trade_no'));

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
  -- Accept the old server's query event format during a rolling deployment, but store one canonical key.
  v_trade := coalesce(nullif(p_payload->>'trade_no',''), p_event_id);
  if length(v_trade)>256 then raise exception 'EMPTY_EVENT'; end if;
  -- Same provider transaction, even across different orders, is serialized before inspecting the inbox.
  perform pg_advisory_xact_lock(hashtextextended('zpay-event:' || v_trade, 0));
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.provider<>'zpay' then raise exception 'PROVIDER_MISMATCH'; end if;
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

create function public.create_pending_order(p_user_id uuid,p_sku text,p_target bigint,p_amount numeric)
returns jsonb language plpgsql set search_path='' as $$
declare v_price numeric; v_order public.orders%rowtype;
begin
  -- Revalidate the server price snapshot while holding a shared product/configuration lock.
  if p_sku='subscription' and p_target is null then
    select (commerce->'subscription_price'->>'amount')::numeric into v_price from public.site_config where id=1 for share;
  elsif p_sku='series' then
    select price into v_price from public.series where id=p_target and type in ('handbook','skill') and status='published' for share;
  elsif p_sku='single' then
    select price into v_price from public.articles where id=p_target and type='blog' and series_id is null and access='paid' and status='published' for share;
  elsif p_sku='event' then
    select d.ticket_price into v_price from public.event_details d join public.series s on s.id=d.series_id
      where s.id=p_target and s.type='event' and s.status='published' and d.state in ('upcoming','registering') for share of s,d;
  end if;
  if v_price is null or v_price<=0 or p_amount is null or p_amount<>v_price then raise exception 'NOT_SELLABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || p_user_id::text || ':' || p_sku || ':' || coalesce(p_target::text,''),0));
  if exists(select 1 from public.entitlements e where e.user_id=p_user_id and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
    and (e.type='subscription' or (e.type=p_sku and e.target_id is not distinct from p_target))) then raise exception 'ALREADY_ENTITLED'; end if;
  select * into v_order from public.orders where user_id=p_user_id and sku_type=p_sku
    and target_id is not distinct from p_target and amount=v_price and status='pending' and provider='zpay'
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_order); end if;
  insert into public.orders(user_id,sku_type,target_id,amount) values(p_user_id,p_sku,p_target,v_price) returning * into v_order;
  return to_jsonb(v_order);
end $$;
revoke all on function public.create_pending_order(uuid,text,bigint,numeric) from public,anon,authenticated;
grant execute on function public.create_pending_order(uuid,text,bigint,numeric) to service_role;

update public.app_schema_version set version='20260928155549' where id=1;
commit;
