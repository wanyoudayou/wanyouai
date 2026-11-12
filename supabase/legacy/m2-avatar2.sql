-- Additive M2-S2 avatar runtime (generation layer). Apply after m2-avatar.sql.
-- avatar_usage：生成用量与配额/熔断依据；avatar_cache：规范化问题 → 首答缓存（命中不计配额）。
-- 两者均由服务端（service_role）写入；站主可审计读；anon/authenticated 无任何权限。

create table if not exists public.avatar_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  ip text,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_avatar_usage_created on public.avatar_usage (created_at);
create index if not exists idx_avatar_usage_user_day on public.avatar_usage (user_id, created_at);

create table if not exists public.avatar_cache (
  question_hash text primary key,
  question_text text not null,
  answer_md text not null,
  sources jsonb not null default '[]'::jsonb,
  model text not null,
  hit_count integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.avatar_usage enable row level security;
alter table public.avatar_cache enable row level security;

create policy avatar_usage_owner_read on public.avatar_usage for select using (public.is_owner());
create policy avatar_cache_owner_read on public.avatar_cache for select using (public.is_owner());

grant select on public.avatar_usage, public.avatar_cache to authenticated;
grant all on public.avatar_usage, public.avatar_cache to service_role;
grant usage, select on sequence public.avatar_usage_id_seq to service_role;
revoke insert, update, delete on public.avatar_usage, public.avatar_cache from public, anon, authenticated;

-- 熔断告警邮件登记（复用 S5 邮件审计表去重）
alter table public.email_sends drop constraint if exists email_sends_kind_check;
alter table public.email_sends add constraint email_sends_kind_check
  check (kind in ('expiry_reminder', 'archive_notice', 'pause_notice', 'avatar_alert'));
