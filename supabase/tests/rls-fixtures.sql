-- Test-only users and entitlement fixtures for M0 RLS acceptance.
-- Do not run this in a public production project.
-- It assumes the release baseline and optional demo.sql have been executed.

-- Paid scenarios need a configured subscription; neutral installs do not set a price.
update public.site_config set commerce = jsonb_set(commerce, '{subscription_price}',
  '{"amount":199,"currency":"CNY","model":"per_year"}'::jsonb) where id=1;

create schema if not exists test_support;

create or replace function test_support.create_auth_user(p_user uuid, p_email text)
returns void
language sql
security definer
set search_path = auth, public
as $$
  insert into auth.users (id, email, email_confirmed_at, aud, role, raw_user_meta_data, raw_app_meta_data)
  values (p_user, p_email, now(), 'authenticated', 'authenticated', '{}'::jsonb, '{}'::jsonb)
  on conflict (id) do nothing;
$$;
revoke all on function test_support.create_auth_user(uuid, text) from public;
grant execute on function test_support.create_auth_user(uuid, text) to service_role;

-- Deterministic users.
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000001', 'owner@example.test');
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000002', 'registered@example.test');
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000003', 'subscriber@example.test');
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000004', 'series-buyer@example.test');
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000005', 'single-buyer@example.test');
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000006', 'event-ticket@example.test');
select test_support.create_auth_user(
  '00000000-0000-4000-8000-000000000007', 'second-owner@example.test');

-- The application calls the claim gate only after checking OWNER_EMAIL.
-- Test the database half under service_role; never run this fixture in production.
set role service_role;
select public.claim_owner_for(
  '00000000-0000-4000-8000-000000000001', 'owner@example.test'
) as first_claim_must_be_true;
select public.claim_owner_for(
  '00000000-0000-4000-8000-000000000007', 'second-owner@example.test'
) as second_claim_must_be_false;

-- Entitlement fixtures. These cover the M0 permission matrix without orders.
insert into entitlements (user_id, type, target_id, ends_at, source, source_ref) values
  ('00000000-0000-4000-8000-000000000003', 'subscription', null, now() + interval '1 year', 'admin', 'test:subscription'),
  ('00000000-0000-4000-8000-000000000004', 'series',
   (select id from series where slug = 'demo-selection-handbook'), null, 'admin', 'test:series'),
  ('00000000-0000-4000-8000-000000000005', 'single',
   (select id from articles where slug = 'demo-paid-single-blog'), null, 'admin', 'test:single'),
  ('00000000-0000-4000-8000-000000000006', 'event',
   (select id from series where slug = 'demo-opc-review-event'), null, 'admin', 'test:event-ticket');

/*
Manual RLS checks. Each block must run as a separate transaction because
auth.uid() is read from request.jwt.claims.

Anonymous:
  set local role anon;
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-paid-single-blog'); -- 0

Registered:
  begin; set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',
    true
  );
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-registered-blog'); -- 1
  commit;

Subscriber:
  begin; set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',
    true
  );
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-subscriber-blog'); -- 1
  commit;

Series buyer:
  begin; set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000004","role":"authenticated"}',
    true
  );
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-selection-scorecard'); -- 1
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-paid-single-blog'); -- 0
  commit;

Single buyer:
  begin; set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}',
    true
  );
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-paid-single-blog'); -- 1
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-selection-scorecard'); -- 0
  commit;

Event ticket holder:
  begin; set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-4000-8000-000000000006","role":"authenticated"}',
    true
  );
  select count(*) from article_bodies where article_id =
    (select id from articles where slug='demo-opc-review-event-notes'); -- 1
  commit;
*/
