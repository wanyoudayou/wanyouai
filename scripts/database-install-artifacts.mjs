const literal = (value) => `'${value.replaceAll("'", "''")}'`;

export function renderInstall(sql, bootstrap) {
  const guard = `do $install$
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception 'This release candidate requires PostgreSQL 17 or later; PostgreSQL 15 compatibility has not been verified.';
  end if;
  if to_regprocedure('auth.uid()') is null or not exists(select 1 from pg_roles where rolname='service_role') then
    raise exception 'Requires Supabase Auth and platform roles. Install into a fresh Supabase project.';
  end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m','f','S')
    and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e'))
    or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and not (p.proname='rls_auto_enable' and p.prorettype='pg_catalog.event_trigger'::regtype) and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')) then
    raise exception 'Existing objects detected in public. This installer is fresh-only; use reviewed upgrade migrations.';
  end if;
  if exists(select 1 from pg_namespace where nspname='ai_internal') then
    raise exception 'Existing objects detected in ai_internal. Use reviewed upgrade migrations.';
  end if;
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname not in ('public','extensions')) then
    raise exception 'Unsupported vector schema. Use a fresh project or review extension relocation first.';
  end if;
end;
$install$;
create schema if not exists extensions;
do $vector$ begin
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='public') then
    alter extension vector set schema extensions;
  end if;
end $vector$;`;
  const body = sql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
  return `-- Generated fresh-install entry for an empty Supabase project.
-- Source: versioned migrations in migrations/. No demo rows or credentials.
-- Platform Storage, Auth URLs and migration-history adoption remain separate.
begin;
${guard}
${body}
${bootstrap}
commit;
`;
}

export function renderDemo(seed) {
  const start = seed.indexOf("\ndo $$\n");
  if (start < 0 || seed.slice(start).includes("site_config")) throw new Error("Legacy demo format changed; inspect the seed split");
  return `-- Generated OPTIONAL demo content from legacy seed.sql; does not change site configuration.
-- Fresh, unused instances only. Includes labelled fictional paid examples, no Auth users.
begin;
do $guard$
begin
  if (select count(*) from public.site_config)<>1 then
    raise exception 'Install and initialize site_config before loading demo content.';
  end if;
  if exists(select 1 from public.articles) or exists(select 1 from public.series)
    or exists(select 1 from public.services) or exists(select 1 from public.custom_pages)
    or exists(select 1 from public.orders) or exists(select 1 from public.bookings)
    or exists(select 1 from public.profiles) then
    raise exception 'Demo import requires an unused instance. Existing data will not be changed.';
  end if;
end;
$guard$;
${seed.slice(start).trim()}
commit;
`;
}

export function renderVerify(catalog, version) {
  const tableNames = catalog.tables.map(({ name }) => `(${literal(name)})`).join(",\n    ");
  const aiRpcNames = ['save_ai_settings','ai_save_connection','reserve_ai_call','dispatch_ai_call','finish_ai_call',
    'start_knowledge_task','knowledge_source_choices','knowledge_evaluation_sources_valid','refresh_ai_public_state','begin_knowledge_index','register_knowledge_source','complete_knowledge_scan','claim_knowledge_batch',
    'finish_knowledge_batch','retry_knowledge_failures','knowledge_index_status','discard_knowledge_generation','match_knowledge',
    'knowledge_runtime_threshold','enable_knowledge_index','confirm_knowledge_evaluation','activate_knowledge_index','accept_knowledge_preview','knowledge_question_manifest','knowledge_missing_sources','begin_knowledge_evaluation','claim_knowledge_evaluation','finish_knowledge_evaluation','retry_knowledge_evaluation'];
  const aiRpcs = aiRpcNames.map(name => {
    const matches = catalog.functions.filter(fn => fn.name === name && fn.signature.startsWith('public.'));
    if (matches.length !== 1) throw new Error(`Expected one service AI RPC: ${name}`);
    return `(${literal(matches[0].signature)})`;
  }).join(',\n    ');
  const deliveryNames = ['expired_skill_uploads','can_use_skill','reserve_skill_upload','claim_skill_confirmation','confirm_skill_release','save_skill_settings',
    'issue_skill_install_grant','redeem_skill_install_grant','begin_skill_turn','migrate_content_kinds',
    'touch_handbook_credential','create_handbook_credential','handbook_principal','handbook_operation','create_synced_handbook',
    'commit_series_publication','stage_handbook_file','publish_handbook_revision','activate_synced_handbook','rename_handbook_file','prepare_handbook_image','link_handbook_image'];
  const deliveryRpcs = deliveryNames.map(name => {
    const matches = catalog.functions.filter(fn => fn.name === name && fn.signature.startsWith('public.'));
    if (matches.length !== 1) throw new Error(`Expected one delivery RPC: ${name}`);
    return `(${literal(matches[0].signature)})`;
  }).join(',\n    ');
  return `-- Generated READ-ONLY application checks. Run as postgres / SQL Editor.
-- All rows must pass. This does not verify Auth redirects, Storage, REST or provider credentials.
with expected_tables(name) as (values
    ${tableNames}
), expected_ai_rpcs(signature) as (values
    ${aiRpcs}
), expected_delivery_rpcs(signature) as (values
    ${deliveryRpcs}
), checks(check_name, passed) as (
  select 'application_tables_present', not exists(select 1 from expected_tables e
    where to_regclass('public.'||quote_ident(e.name)) is null)
  union all select 'application_rls_enabled', not exists(select 1 from expected_tables e
    left join pg_class c on c.oid=to_regclass('public.'||quote_ident(e.name)) where coalesce(c.relrowsecurity,false)=false)
  union all select 'api_table_maintenance_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join expected_tables tables cross join
    (values ('TRUNCATE'),('TRIGGER'),('REFERENCES'),('MAINTAIN')) privileges(name)
    where has_table_privilege(roles.name,'public.'||quote_ident(tables.name),privileges.name))
  union all select 'application_policy_count', (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (select name from expected_tables))=${catalog.policies.length}
  union all select 'site_config_singleton', (select count(*)=1 and min(id)=1 from public.site_config)
  union all select 'ai_private_data_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join
    (values ('ai_connections'),('ai_settings'),('ai_calls'),('knowledge_index_generations'),('knowledge_index_control'),('knowledge_index_items'),('knowledge_evaluations'),('knowledge_sources')) tables(name)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege(roles.name,'public.'||quote_ident(tables.name),privileges.name)
      or case when privileges.name<>'DELETE' then has_any_column_privilege(roles.name,'public.'||quote_ident(tables.name),privileges.name) else false end)
  union all select 'ai_rpc_service_only', not exists(select 1 from expected_ai_rpcs e
    left join pg_proc p on p.oid=to_regprocedure(e.signature)
    where p.oid is null or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
       or not has_function_privilege('service_role',p.oid,'EXECUTE') or p.prosecdef or p.proconfig is distinct from array['search_path=""'])
  union all select 'skill_handbook_private_data_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join
    (values ('skill_releases'),('skill_uploads'),('skill_install_grants'),('skill_sessions'),('skill_turns'),('handbook_credentials'),('handbook_sync_operations'),('handbook_media_uploads')) tables(name)
    cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege(roles.name,'public.'||quote_ident(tables.name),privileges.name)
      or case when privileges.name<>'DELETE' then has_any_column_privilege(roles.name,'public.'||quote_ident(tables.name),privileges.name) else false end)
  union all select 'skill_handbook_rpc_service_only', not exists(select 1 from expected_delivery_rpcs e
    left join pg_proc p on p.oid=to_regprocedure(e.signature)
    where p.oid is null or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
      or not has_function_privilege('service_role',p.oid,'EXECUTE') or p.prosecdef or p.proconfig is distinct from case when p.proname='commit_series_publication' then array['search_path=""','lock_timeout=5s','statement_timeout=25s'] else array['search_path=""'] end)
  union all select 'skill_release_immutable', not exists(select 1 from (values ('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege('service_role','public.skill_releases',privileges.name))
  union all select 'skill_storage_restrictive_policy', to_regclass('storage.objects') is null or exists(select 1 from pg_policy
    where polrelid=to_regclass('storage.objects') and polname='skill_packages_private' and not polpermissive and polcmd='*'
      and polroles=array['anon'::regrole::oid,'authenticated'::regrole::oid]
      and pg_get_expr(polqual,polrelid)='(bucket_id <> ''skill-packages''::text)'
      and pg_get_expr(polwithcheck,polrelid)='(bucket_id <> ''skill-packages''::text)')
  union all select 'skill_lifecycle_triggers_enabled', (select count(*)=2 from pg_trigger
    where tgname='sync_legacy_skill_lifecycle' and tgenabled='O' and tgrelid in ('public.articles'::regclass,'public.series'::regclass))
  union all select 'skill_export_service_only', not has_function_privilege('anon','public.export_site_snapshot(boolean,boolean)','EXECUTE')
    and not has_function_privilege('authenticated','public.export_site_snapshot(boolean,boolean)','EXECUTE')
    and has_function_privilege('service_role','public.export_site_snapshot(boolean,boolean)','EXECUTE')
  union all select 'ai_internal_execute_denied', exists(select 1 from pg_namespace where nspname='ai_internal') and not exists(select 1 from
    (values ('anon'),('authenticated'),('service_role')) roles(name) cross join pg_namespace n
    where n.nspname='ai_internal' and (has_schema_privilege(roles.name,n.oid,'USAGE') or has_schema_privilege(roles.name,n.oid,'CREATE')
      or exists(select 1 from pg_proc p where p.pronamespace=n.oid and has_function_privilege(roles.name,p.oid,'EXECUTE'))))
  union all select 'ai_self_usage_authenticated',
    not has_function_privilege('anon','public.avatar_usage_today()','EXECUTE')
    and not has_function_privilege('service_role','public.avatar_usage_today()','EXECUTE')
    and has_function_privilege('authenticated','public.avatar_usage_today()','EXECUTE')
    and exists(select 1 from pg_proc where oid='public.avatar_usage_today()'::regprocedure and prosecdef and proconfig=array['search_path=""'])
  union all select 'ai_owner_usage_authenticated',
    not has_function_privilege('anon','public.admin_dashboard_card(text)','EXECUTE')
    and not has_function_privilege('service_role','public.admin_dashboard_card(text)','EXECUTE')
    and has_function_privilege('authenticated','public.admin_dashboard_card(text)','EXECUTE')
    and exists(select 1 from pg_proc where oid='public.admin_dashboard_card(text)'::regprocedure and prosecdef and proconfig=array['search_path=""'])
  union all select 'knowledge_source_triggers_enabled', (select count(*)=4 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='ai_internal' and p.proname='knowledge_sources_changed' and t.tgenabled='O'
      and t.tgrelid in ('public.articles'::regclass,'public.article_chunks'::regclass,'public.series'::regclass,'public.conversation_publications'::regclass))
  union all select 'application_schema_version', (select count(*)=1 and min(version)=${literal(version)} from public.app_schema_version where id=1)
  union all select 'version_api_write_denied', not exists(select 1 from
    (values ('anon'),('authenticated'),('service_role')) roles(name) cross join
    (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('TRIGGER'),('REFERENCES'),('MAINTAIN')) privileges(name)
    where has_table_privilege(roles.name,'public.app_schema_version',privileges.name))
  union all select 'vector_in_extensions', exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='extensions')
  union all select 'vector_search_service_only',
    not has_function_privilege('anon','public.match_chunks(extensions.vector,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.match_chunks(extensions.vector,integer)','EXECUTE')
    and has_function_privilege('service_role','public.match_chunks(extensions.vector,integer)','EXECUTE')
  union all select 'export_snapshot_service_only',
    not has_function_privilege('anon','public.export_site_snapshot()','EXECUTE')
    and not has_function_privilege('authenticated','public.export_site_snapshot()','EXECUTE')
    and has_function_privilege('service_role','public.export_site_snapshot()','EXECUTE')
    and exists(select 1 from pg_proc where oid='public.export_site_snapshot()'::regprocedure
      and provolatile='s' and prosecdef and proconfig=array['search_path=""'])
  union all select 'avatar_quota_service_only', not exists(select 1 from
    (values ('public.reserve_avatar_generation(uuid,uuid,text,text)'),('public.dispatch_avatar_generation(uuid)'),
      ('public.finish_avatar_generation(uuid,text,integer,integer)')) f(name)
    where has_function_privilege('anon',f.name,'EXECUTE') or has_function_privilege('authenticated',f.name,'EXECUTE')
      or not has_function_privilege('service_role',f.name,'EXECUTE')
      or not exists(select 1 from pg_proc where oid=f.name::regprocedure and not prosecdef and proconfig=array['search_path=""']))
  union all select 'trigger_rpc_execute_denied', not exists(select 1 from
    (values ('anon'),('authenticated'),('service_role')) roles(name) cross join (values ('public.handle_new_user()'),('public.set_updated_at()'),('public.guard_content_lifecycle()'),('public.queue_grant_email()'),('public.guard_ai_connection_version()'),('public.initialize_skill()'),('public.sync_legacy_skill_lifecycle()')) functions(name)
    where has_function_privilege(roles.name,functions.name,'EXECUTE'))
  union all select 'at_most_one_owner', (select count(*)<=1 from public.profiles where is_owner)
  union all select 'owner_bootstrap_service_only',
    not has_function_privilege('anon','public.claim_owner_for(uuid,text)','EXECUTE')
    and not has_function_privilege('authenticated','public.claim_owner_for(uuid,text)','EXECUTE')
    and has_function_privilege('service_role','public.claim_owner_for(uuid,text)','EXECUTE')
  union all select 'legacy_owner_claim_absent', to_regprocedure('public.claim_owner()') is null
  union all select 'payment_service_only',
    not has_function_privilege('anon','public.settle_payment(bigint,text,numeric,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.settle_payment(bigint,text,numeric,jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.settle_payment(bigint,text,numeric,jsonb)','EXECUTE')
  union all select 'merchant_order_reference',
    exists(select 1 from pg_attribute where attrelid='public.orders'::regclass
      and attname='merchant_order_no' and attnotnull and not attisdropped)
    and exists(select 1 from pg_constraint where conrelid='public.orders'::regclass
      and conname='orders_merchant_order_no_unique' and contype='u')
    and exists(select 1 from pg_constraint where conrelid='public.orders'::regclass
      and conname='orders_merchant_order_no_format' and contype='c')
    and not exists(select 1 from public.orders where merchant_order_no !~ '^9[0-9]{31}$'
      and (status='pending' or merchant_order_no<>id::text))
  union all select 'merchant_order_rpc_service_only',
    not has_function_privilege('anon','public.new_merchant_order_no()','EXECUTE')
    and not has_function_privilege('authenticated','public.new_merchant_order_no()','EXECUTE')
    and has_function_privilege('service_role','public.new_merchant_order_no()','EXECUTE')
    and not has_function_privilege('anon','public.settle_payment_reference(text,text,numeric,jsonb)','EXECUTE')
    and not has_function_privilege('authenticated','public.settle_payment_reference(text,text,numeric,jsonb)','EXECUTE')
    and has_function_privilege('service_role','public.settle_payment_reference(text,text,numeric,jsonb)','EXECUTE')
    and not exists(select 1 from (values ('public.new_merchant_order_no()'),
      ('public.settle_payment_reference(text,text,numeric,jsonb)'),
      ('public.settle_payment(bigint,text,numeric,jsonb)'),('public.settle_payment_queued(bigint,text,numeric,jsonb)')) f(name)
      where not exists(select 1 from pg_proc where oid=f.name::regprocedure
        and not prosecdef and proconfig=array['search_path=""']))
  union all select 'payment_reconcile_service_only',
    exists(select 1 from pg_attribute where attrelid='public.orders'::regclass
      and attname='reconcile_checked_at' and not attisdropped)
    and exists(select 1 from pg_class where oid=to_regclass('public.idx_orders_pending_reconcile') and relkind='i')
    and not has_function_privilege('anon','public.claim_pending_payment_reconciliation()','EXECUTE')
    and not has_function_privilege('authenticated','public.claim_pending_payment_reconciliation()','EXECUTE')
    and has_function_privilege('service_role','public.claim_pending_payment_reconciliation()','EXECUTE')
    and exists(select 1 from pg_proc where oid='public.claim_pending_payment_reconciliation()'::regprocedure
      and not prosecdef and proconfig=array['search_path=""'])
  union all select 'order_creation_service_only',
    not has_function_privilege('anon','public.create_pending_order(uuid,text,bigint,numeric)','EXECUTE')
    and not has_function_privilege('authenticated','public.create_pending_order(uuid,text,bigint,numeric)','EXECUTE')
    and has_function_privilege('service_role','public.create_pending_order(uuid,text,bigint,numeric)','EXECUTE')
  union all select 'email_outbox_client_access_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege(roles.name,'public.email_outbox',privileges.name))
  union all select 'email_outbox_service_privileges',
    has_table_privilege('service_role','public.email_outbox','SELECT')
    and has_table_privilege('service_role','public.email_outbox','INSERT')
    and has_table_privilege('service_role','public.email_outbox','UPDATE')
    and not exists(select 1 from (values ('DELETE'),('TRUNCATE'),('TRIGGER'),('REFERENCES'),('MAINTAIN')) privileges(name)
      where has_table_privilege('service_role','public.email_outbox',privileges.name))
  union all select 'email_outbox_rpc_service_only', not exists(select 1 from
    (values ('public.settle_payment_queued(bigint,text,numeric,jsonb)'),('public.claim_email_job()'),
      ('public.prepare_email_job(uuid,uuid,jsonb,text)'),('public.finish_email_job(uuid,uuid,text,text,text)'),('public.email_outbox_health()')) functions(name)
    where has_function_privilege('anon',functions.name,'EXECUTE') or has_function_privilege('authenticated',functions.name,'EXECUTE')
      or not has_function_privilege('service_role',functions.name,'EXECUTE'))
  union all select 'email_outbox_trigger_enabled', exists(select 1 from pg_trigger
    where tgname='queue_grant_email' and tgenabled='O' and tgrelid='public.entitlements'::regclass)
  union all select 'conversation_client_insert_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join
    (values ('public.conversations'),('public.conversation_messages')) tables(name)
    where has_table_privilege(roles.name,tables.name,'INSERT'))
  union all select 'content_lifecycle_triggers_enabled', (select count(*)=2 from pg_trigger
    where tgname='guard_content_lifecycle' and tgenabled='O' and tgrelid in ('public.articles'::regclass,'public.series'::regclass))
  union all select 'booking_rpc_authenticated_only',
    not has_function_privilege('anon','public.manage_booking(bigint,timestamp with time zone,text,jsonb)','EXECUTE')
    and has_function_privilege('authenticated','public.manage_booking(bigint,timestamp with time zone,text,jsonb)','EXECUTE')
  union all select 'booking_direct_write_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join
    (values ('public.bookings'),('public.milestones')) tables(name) cross join
    (values ('INSERT'),('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege(roles.name,tables.name,privileges.name))
  union all select 'sensitive_writes_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join
    (values ('public.article_bodies'),('public.article_versions'),('public.payment_events'),('public.orders')) tables(name) cross join
    (values ('INSERT'),('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege(roles.name,tables.name,privileges.name))
  union all select 'entitlement_update_delete_denied', not exists(select 1 from
    (values ('anon'),('authenticated')) roles(name) cross join (values ('UPDATE'),('DELETE')) privileges(name)
    where has_table_privilege(roles.name,'public.entitlements',privileges.name))
  union all select 'auth_profile_trigger_enabled', exists(select 1 from pg_trigger t
    join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace
    where t.tgrelid='auth.users'::regclass and n.nspname='public' and p.proname='handle_new_user' and t.tgenabled='O')
)
select check_name, coalesce(passed,false) passed from checks order by check_name;
`;
}
