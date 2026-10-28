-- Fix V1-2（2026-09-26）：昵称保存改 SECURITY DEFINER RPC。
-- 背景：列级 grant + RLS 在 Postgres 层验证通过，但 PostgREST 对列级 UPDATE 的判定在生产持续 42501；
-- 改走与 client_respond_booking 同构的 RPC 模式（函数内身份校验 + 服务端字段白名单），彻底绕开该歧义。
-- 在 v1-profile-fix.sql 之后执行。

create or replace function public.set_display_name(p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', '请先登录');
  end if;
  if v_name is not null and char_length(v_name) > 40 then
    return jsonb_build_object('ok', false, 'message', '昵称不超过 40 字');
  end if;
  -- 只写 display_name；缺行自愈；is_owner 等列不可触碰
  insert into public.profiles (id, display_name) values (v_uid, v_name)
  on conflict (id) do update set display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'message', case when v_name is null then '已清除昵称' else '已保存' end);
end $$;

revoke all on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- 直写路径退役：收回自助 insert/update（保留自助读），统一走 RPC
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_self_update_display_name on public.profiles;
revoke insert (id, display_name) on public.profiles from authenticated;
revoke update (display_name) on public.profiles from authenticated;
