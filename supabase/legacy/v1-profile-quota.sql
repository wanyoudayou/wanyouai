-- Additive V1（2026-09-25 站主裁定）：个人中心昵称 + 今日会话配额展示。
-- ① profiles.display_name：自助修改；列级授权只放 display_name（RLS 行级 + GRANT 列级双闸，is_owner 不可被用户提权）。
-- ② avatar_usage 本人可读（个人中心今日配额）。
-- 在 v1-orders6.sql 之后执行。

alter table public.profiles
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 40);

create policy profiles_self_update_display_name on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
-- 列级授权：仅 display_name 可改（is_owner 等列保持不可写）
grant update (display_name) on public.profiles to authenticated;

create policy avatar_usage_self_read on public.avatar_usage for select
  using (user_id = auth.uid());
