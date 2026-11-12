-- Fix V1（2026-09-26）：profiles 缺行的静默失败（非站主保存昵称假成功）。
-- ① 回填：为所有缺 profile 的用户补建行；
-- ② 触发器兜底：on_auth_user_created 缺失则重建（函数取 m3-checkin.sql 版本为准，此处不重复定义）；
-- ③ 自助 upsert 支持：insert 仅限本人行且 is_owner=false（列级授权只放 id/display_name，防提权）。
-- 在 v1-profile-quota.sql 之后执行。

-- ① 回填缺失的 profiles
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ② 触发器兜底（幂等）
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ③ 自助建行（upsert 的 insert 半边）
create policy profiles_self_insert on public.profiles for insert
  with check (id = auth.uid() and is_owner = false);
grant insert (id, display_name) on public.profiles to authenticated;
