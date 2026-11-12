-- Additive V1 自定义页面发布位置。Apply after v1-custom-pages.sql。
-- placement：nav=左侧栏 / footer=底部 / none=不固定；回填：已有 nav_label 的页面归 nav。

alter table public.custom_pages
  add column if not exists placement text not null default 'none'
    check (placement in ('nav', 'footer', 'none'));

update public.custom_pages set placement = 'nav' where nav_label is not null and placement = 'none';

drop index if exists public.idx_custom_pages_nav;
create index if not exists idx_custom_pages_nav on public.custom_pages (placement, nav_order)
  where status = 'published' and placement <> 'none';
