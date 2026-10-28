-- M1 accounts. Run after schema.sql on fresh installs; for existing deployments
-- apply once as an incremental migration.
-- Auto-create a profiles row for every new auth user. The owner gate stays the
-- M0 one-shot claim_owner() (upsert-compatible with the trigger-created row).

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The trigger fires as the function owner; no role may invoke it directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;
