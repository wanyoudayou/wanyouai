-- Additive, read-only export API. No application rows or RLS policies are changed.
begin;
do $guard$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20260929134545') then
    raise exception 'EXPORT_UPGRADE_REQUIRES_20260929134545';
  end if;
end $guard$;

-- A STABLE SQL function uses the calling SELECT's MVCC snapshot for every subquery.
-- SECURITY DEFINER is needed only for selected Auth profile fields. API access is
-- restricted to service_role below; owner HTTP authorization remains in the app.
-- No parameters, dynamic SQL, write statements, site_secrets or Auth credentials.
create function public.export_site_snapshot() returns jsonb
language sql stable security definer set search_path = '' as $export$
  select jsonb_build_object(
    'format', 'wanyou.snapshot/1',
    'captured_at', statement_timestamp(),
    'rows', jsonb_build_object(
      'app_schema_version', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.app_schema_version t),
      'article_bodies', (select coalesce(jsonb_agg(to_jsonb(t) order by t.article_id),'[]'::jsonb) from public.article_bodies t),
      'article_chunks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.article_chunks t),
      'article_reviews', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.article_reviews t),
      'article_versions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.article_versions t),
      'articles', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.articles t),
      'avatar_cache', (select coalesce(jsonb_agg(to_jsonb(t) order by t.question_hash),'[]'::jsonb) from public.avatar_cache t),
      'avatar_usage', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.avatar_usage t),
      'bookings', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.bookings t),
      'content_assets', (select coalesce(jsonb_agg(to_jsonb(t) order by t.scope, t.path),'[]'::jsonb) from public.content_assets t),
      'content_file_revisions', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.content_file_revisions t),
      'content_files', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.content_files t),
      'conversation_messages', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.conversation_messages t),
      'conversation_publications', (select coalesce(jsonb_agg(to_jsonb(t) order by t.conversation_id),'[]'::jsonb) from public.conversation_publications t),
      'conversations', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.conversations t),
      'custom_pages', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.custom_pages t),
      'email_outbox', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.email_outbox t),
      'email_sends', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.email_sends t),
      'entitlements', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.entitlements t),
      'evaluations', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.evaluations t),
      'event_details', (select coalesce(jsonb_agg(to_jsonb(t) order by t.series_id),'[]'::jsonb) from public.event_details t),
      'inbox_items', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.inbox_items t),
      'milestones', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.milestones t),
      'orders', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.orders t),
      'payment_events', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.payment_events t),
      'profiles', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.profiles t),
      'publish_requests', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.publish_requests t),
      'registrations', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.registrations t),
      'series', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.series t),
      'services', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.services t),
      'site_config', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.site_config t),
      'skill_details', (select coalesce(jsonb_agg(to_jsonb(t) order by t.series_id),'[]'::jsonb) from public.skill_details t)
    ),
    'users', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'email', u.email, 'phone', to_jsonb(u)->'phone',
      'created_at', u.created_at, 'updated_at', to_jsonb(u)->'updated_at',
      'last_sign_in_at', to_jsonb(u)->'last_sign_in_at', 'email_confirmed_at', u.email_confirmed_at,
      'app_metadata', u.raw_app_meta_data, 'user_metadata', u.raw_user_meta_data
    ) order by u.id),'[]'::jsonb) from auth.users u)
  );
$export$;
revoke all on function public.export_site_snapshot() from public, anon, authenticated, service_role;
grant execute on function public.export_site_snapshot() to service_role;

update public.app_schema_version set version='20261008111841',applied_at=now() where id=1;
commit;
