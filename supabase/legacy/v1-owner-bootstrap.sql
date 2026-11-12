-- V1 owner bootstrap hardening. Apply after the existing V1 SQL chain.
-- Existing owners remain unchanged. New claims are restricted to a server-only
-- RPC that checks the verified Auth email against OWNER_EMAIL passed by the app.
begin;

revoke all on function public.claim_owner() from public, anon, authenticated, service_role;
drop function public.claim_owner();

create or replace function public.claim_owner_for(
  p_user_id uuid,
  p_expected_email text
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_user_id is null or nullif(btrim(p_expected_email), '') is null then
    return false;
  end if;

  -- Keep the existing one-owner serialization, including concurrent requests.
  perform pg_catalog.pg_advisory_xact_lock(793710621);

  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and u.email_confirmed_at is not null
      and pg_catalog.lower(pg_catalog.btrim(u.email)) =
          pg_catalog.lower(pg_catalog.btrim(p_expected_email))
  ) then
    return false;
  end if;

  if exists (select 1 from public.profiles where id = p_user_id and is_owner) then
    return true;
  end if;
  if exists (select 1 from public.profiles where is_owner) then
    return false;
  end if;

  insert into public.profiles (id, is_owner) values (p_user_id, true)
  on conflict (id) do update set is_owner = true
  where public.profiles.is_owner = false;
  return true;
end;
$$;

revoke all on function public.claim_owner_for(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_owner_for(uuid, text) to service_role;

commit;
