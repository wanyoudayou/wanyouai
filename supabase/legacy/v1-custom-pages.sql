-- Additive V1 自定义页面。Apply after m3-checkin.sql。
-- custom_pages：站主自建的富样式页面（/p/[slug] 公开路由；nav_label 非空即进左栏导航）。

create table if not exists public.custom_pages (
  id bigint generated always as identity primary key,
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  title text not null,
  description text,
  html text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'archived')),
  nav_label text,
  nav_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_custom_pages_nav on public.custom_pages (nav_order)
  where status = 'published' and nav_label is not null;

alter table public.custom_pages enable row level security;

-- 公开读：仅已发布
create policy custom_pages_public_read on public.custom_pages for select
  using (status = 'published');
-- 站主全读写
create policy custom_pages_owner_all on public.custom_pages for all
  using (public.is_owner()) with check (public.is_owner());

grant select on public.custom_pages to anon, authenticated;
grant insert, update, delete on public.custom_pages to authenticated;
grant all on public.custom_pages to service_role;
