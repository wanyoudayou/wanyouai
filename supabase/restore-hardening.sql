-- Run after a Supabase CLI logical restore, before exposing the target app.
-- pg_dump replays source ACLs relative to source defaults; a new hosted project
-- can start with different default table grants. This removes only maintenance
-- privileges that the Data API roles never need; existing DML grants remain.
begin;

revoke maintain, references, trigger, truncate on all tables in schema public
  from anon, authenticated;

-- These two tables deliberately have narrower service permissions than other
-- application tables. Hosted defaults can survive a grant-only logical dump.
revoke maintain, references, trigger, truncate
  on public.app_schema_version, public.email_outbox from service_role;

-- A logical backup can omit this RPC's ACL. Restore the application's
-- explicit RPC boundary, even though this invoker function also observes RLS.
revoke all on function public.match_chunks(extensions.vector, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.match_chunks(extensions.vector, integer)
  to service_role;

-- Older backups do not contain the new export API. Harden it only when present.
do $export_acl$ begin
  if to_regprocedure('public.export_site_snapshot()') is not null then
    revoke all on function public.export_site_snapshot() from public, anon, authenticated, service_role;
    grant execute on function public.export_site_snapshot() to service_role;
  end if;
end $export_acl$;

-- Quota authority is service-only; older backups may predate these functions.
do $quota_acl$ declare f text; begin
  foreach f in array array['public.reserve_avatar_generation(uuid,uuid,text,text)',
    'public.dispatch_avatar_generation(uuid)','public.finish_avatar_generation(uuid,text,integer,integer)'] loop
    if to_regprocedure(f) is not null then
      execute 'revoke all on function ' || f || ' from public,anon,authenticated,service_role';
      execute 'grant execute on function ' || f || ' to service_role';
    end if;
  end loop;
end $quota_acl$;

-- Merchant order references and their settlement entry point remain private
-- after restoring a dump onto a project with different function defaults.
do $payment_reference_acl$ declare f text; begin
  foreach f in array array['public.new_merchant_order_no()',
    'public.settle_payment_reference(text,text,numeric,jsonb)'] loop
    if to_regprocedure(f) is not null then
      execute 'revoke all on function ' || f || ' from public,anon,authenticated,service_role';
      execute 'grant execute on function ' || f || ' to service_role';
    end if;
  end loop;
end $payment_reference_acl$;

-- Private AI state stays private even when hosted defaults differ after restore.
do $ai_acl$ declare object_name text; f record; begin
  foreach object_name in array array['ai_connections','ai_settings','ai_calls','knowledge_index_control',
    'knowledge_index_generations','knowledge_index_items','knowledge_evaluations','knowledge_sources'] loop
    if to_regclass('public.'||object_name) is not null then
      execute 'revoke all on public.'||quote_ident(object_name)||' from public,anon,authenticated';
    end if;
  end loop;
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('ai_save_connection','save_ai_settings','reserve_ai_call','dispatch_ai_call','finish_ai_call',
      'refresh_ai_public_state','begin_knowledge_index','register_knowledge_source','complete_knowledge_scan','claim_knowledge_batch','finish_knowledge_batch',
      'retry_knowledge_failures','knowledge_index_status','discard_knowledge_generation','match_knowledge','confirm_knowledge_evaluation',
      'activate_knowledge_index','begin_knowledge_evaluation','claim_knowledge_evaluation','finish_knowledge_evaluation','retry_knowledge_evaluation') loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
    execute 'grant execute on function '||f.signature||' to service_role';
  end loop;
  if to_regnamespace('ai_internal') is not null then
    revoke all on schema ai_internal from public,anon,authenticated,service_role;
    revoke all on all functions in schema ai_internal from public,anon,authenticated,service_role;
  end if;
  if to_regprocedure('public.avatar_usage_today()') is not null then
    revoke all on function public.avatar_usage_today() from public,anon,authenticated,service_role;
    grant execute on function public.avatar_usage_today() to authenticated;
  end if;
end $ai_acl$;

-- Future tables require explicit grants in their migrations. This does not
-- change current table DML privileges.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

commit;
