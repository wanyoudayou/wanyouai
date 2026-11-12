-- Additive M2-S4 inbox & conversation review. Apply after m2-avatar2.sql.
-- inbox_items：站主收件箱（分身转人工 + 服务询价统一入口）；conversations 补站主审核 update policy。

create table if not exists public.inbox_items (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('escalation', 'inquiry')),
  user_id uuid references auth.users (id) on delete set null,
  contact text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists idx_inbox_items_status on public.inbox_items (status, created_at desc);

alter table public.inbox_items enable row level security;

-- 仅站主可读与标记处理；写入只走服务端 API（service_role），客户端不可直接写。
create policy inbox_items_owner_read on public.inbox_items for select using (public.is_owner());
create policy inbox_items_owner_update on public.inbox_items for update
  using (public.is_owner()) with check (public.is_owner());

grant select, update on public.inbox_items to authenticated;
grant all on public.inbox_items to service_role;
grant usage, select on sequence public.inbox_items_id_seq to service_role;
revoke insert, delete on public.inbox_items from public, anon, authenticated;

-- 会话审核（pending → public / hidden）：仅站主可改状态；内容字段不可被修改（审核即定稿）。
create policy conversations_owner_review on public.conversations for update
  using (public.is_owner())
  with check (public.is_owner());
grant update (status) on public.conversations to authenticated;
