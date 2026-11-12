-- Generated READ-ONLY application checks. Run as postgres / SQL Editor.
-- All rows must pass. This does not verify Auth redirects, Storage, REST or provider credentials.
with expected_tables(name) as (values
    ('ai_calls'),
    ('ai_connections'),
    ('ai_settings'),
    ('app_schema_version'),
    ('article_bodies'),
    ('article_chunks'),
    ('article_reviews'),
    ('article_versions'),
    ('articles'),
    ('avatar_cache'),
    ('avatar_usage'),
    ('bookings'),
    ('content_assets'),
    ('content_file_revisions'),
    ('content_files'),
    ('conversation_messages'),
    ('conversation_publications'),
    ('conversations'),
    ('custom_pages'),
    ('email_outbox'),
    ('email_sends'),
    ('entitlements'),
    ('evaluations'),
    ('event_details'),
    ('handbook_credentials'),
    ('handbook_media_uploads'),
    ('handbook_sync_operations'),
    ('inbox_items'),
    ('knowledge_evaluations'),
    ('knowledge_index_control'),
    ('knowledge_index_generations'),
    ('knowledge_index_items'),
    ('knowledge_question_drafts'),
    ('media_assets'),
    ('media_uploads'),
    ('milestones'),
    ('orders'),
    ('payment_events'),
    ('profiles'),
    ('publish_requests'),
    ('registrations'),
    ('series'),
    ('services'),
    ('site_config'),
    ('site_secrets'),
    ('skill_details'),
    ('skill_install_grants'),
    ('skill_releases'),
    ('skill_sessions'),
    ('skill_turns'),
    ('skill_uploads'),
    ('skills'),
    ('starter_imports')
), expected_ai_rpcs(signature) as (values
    ('public.save_ai_settings(uuid, uuid, jsonb, text, jsonb, text, boolean, jsonb)'),
    ('public.ai_save_connection(uuid, jsonb, text)'),
    ('public.reserve_ai_call(uuid, text, uuid, uuid, text)'),
    ('public.dispatch_ai_call(uuid)'),
    ('public.finish_ai_call(uuid, text, integer, integer)'),
    ('public.start_knowledge_task(uuid, text, boolean, bigint, uuid)'),
    ('public.knowledge_source_choices(text)'),
    ('public.knowledge_evaluation_sources_valid(text[])'),
    ('public.refresh_ai_public_state()'),
    ('public.begin_knowledge_index(uuid, boolean, uuid, bigint, uuid)'),
    ('public.register_knowledge_source(uuid, text, text, jsonb)'),
    ('public.complete_knowledge_scan(uuid)'),
    ('public.claim_knowledge_batch(uuid, uuid)'),
    ('public.finish_knowledge_batch(uuid, uuid, jsonb, text)'),
    ('public.retry_knowledge_failures(uuid, uuid, boolean)'),
    ('public.knowledge_index_status()'),
    ('public.discard_knowledge_generation(uuid, uuid)'),
    ('public.match_knowledge(uuid, extensions.vector, double precision, integer, text[])'),
    ('public.knowledge_runtime_threshold(uuid)'),
    ('public.enable_knowledge_index(uuid, uuid, bigint, uuid, boolean)'),
    ('public.confirm_knowledge_evaluation(uuid, bigint, double precision, jsonb)'),
    ('public.activate_knowledge_index(uuid, uuid)'),
    ('public.accept_knowledge_preview(uuid, uuid, boolean)'),
    ('public.knowledge_question_manifest(uuid)'),
    ('public.knowledge_missing_sources(text[])'),
    ('public.begin_knowledge_evaluation(uuid, uuid, jsonb, boolean)'),
    ('public.claim_knowledge_evaluation(uuid, uuid)'),
    ('public.finish_knowledge_evaluation(uuid, uuid, jsonb, boolean)'),
    ('public.retry_knowledge_evaluation(uuid, uuid, boolean)')
), expected_delivery_rpcs(signature) as (values
    ('public.expired_skill_uploads(uuid, bigint)'),
    ('public.can_use_skill(bigint, uuid)'),
    ('public.reserve_skill_upload(uuid, bigint, uuid, text, text, text, integer)'),
    ('public.claim_skill_confirmation(uuid, uuid)'),
    ('public.confirm_skill_release(uuid, uuid, jsonb, text, text, boolean)'),
    ('public.save_skill_settings(bigint, uuid, bigint, numeric, uuid, boolean, text)'),
    ('public.issue_skill_install_grant(uuid, uuid, text)'),
    ('public.redeem_skill_install_grant(text)'),
    ('public.begin_skill_turn(uuid, bigint, uuid, uuid, text)'),
    ('public.migrate_content_kinds(uuid)'),
    ('public.touch_handbook_credential(text)'),
    ('public.create_handbook_credential(uuid, text, text)'),
    ('public.handbook_principal(uuid, bigint)'),
    ('public.handbook_operation(uuid, uuid, text, text)'),
    ('public.create_synced_handbook(uuid, uuid, text, text, text)'),
    ('public.commit_series_publication(bigint, timestamp with time zone, uuid, jsonb, boolean, text)'),
    ('public.stage_handbook_file(uuid, uuid, text, text, text, text, text, jsonb, bigint, timestamp with time zone, boolean)'),
    ('public.publish_handbook_revision(uuid, uuid, text, bigint, jsonb)'),
    ('public.activate_synced_handbook(uuid, uuid, text, bigint, bigint, timestamp with time zone)'),
    ('public.rename_handbook_file(uuid, uuid, text, bigint, text, bigint)'),
    ('public.prepare_handbook_image(uuid, bigint, uuid, text, text, text, integer)'),
    ('public.link_handbook_image(uuid, bigint, uuid, text, text)')
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
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (select name from expected_tables))=52
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
  union all select 'application_schema_version', (select count(*)=1 and min(version)='20261026184628' from public.app_schema_version where id=1)
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
