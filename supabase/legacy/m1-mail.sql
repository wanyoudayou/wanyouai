-- Additive M1-S5 transactional mail outbox. Apply after m1-payments.sql.
-- Records dedupe keys for idempotent sends (expiry reminders, archive notices)
-- and provides an audit trail. Grant mails are naturally once-per-order and
-- therefore do not need rows here.

create table if not exists public.email_sends (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('expiry_reminder', 'archive_notice', 'pause_notice', 'avatar_alert')),
  ref_id text not null,
  sent_to text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (kind, ref_id)
);

alter table public.email_sends enable row level security;

-- Owner may audit the outbox; inserts are reserved to service-role server paths.
create policy email_sends_owner_read on public.email_sends for select
  using (public.is_owner());

grant select on public.email_sends to authenticated;
grant all on public.email_sends to service_role;
grant usage, select on sequence public.email_sends_id_seq to service_role;
revoke insert, update, delete on public.email_sends from public, anon, authenticated;
