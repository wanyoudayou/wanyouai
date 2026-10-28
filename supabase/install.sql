-- Generated fresh-install entry for an empty Supabase project.
-- Source: versioned migrations in migrations/. No demo rows or credentials.
-- Platform Storage, Auth URLs and migration-history adoption remain separate.
begin;
do $install$
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
end $vector$;
-- Source migration: 20260928124423_release_baseline.sql
-- Release baseline migration: maintenance source after adoption.

-- Complete application structure, neutral singleton and application version.

-- Unreleased candidate. Existing instances use the dedicated reviewed upgrade.


create schema if not exists extensions;

create extension if not exists vector with schema extensions;

do $migration_platform$
begin
  if exists(select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='vector' and n.nspname='public') then
    alter extension vector set schema extensions;
  end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='rls_auto_enable' and p.prorettype='pg_catalog.event_trigger'::regtype and p.pronargs=0) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role';
  end if;
end $migration_platform$;


grant usage on schema extensions to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;

-- Hosted projects can start with permissive default table ACLs. All Data API
-- access below is granted explicitly after the tables and RLS policies exist.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

create table public."app_schema_version" (
  "id" integer default 1 not null,
  "version" text not null,
  "applied_at" timestamp with time zone default now() not null
);

create table public."article_bodies" (
  "article_id" bigint not null,
  "content" text not null
);

create table public."article_chunks" (
  "id" bigint generated always as identity not null,
  "article_id" bigint not null,
  "series_id" bigint,
  "access" text not null,
  "chunk_type" text default 'body'::text not null,
  "chunk_no" integer not null,
  "content" text not null,
  "source_path" text,
  "embedding" extensions.vector(1024),
  "created_at" timestamp with time zone default now() not null
);

create table public."article_reviews" (
  "id" bigint generated always as identity not null,
  "article_id" bigint not null,
  "user_id" uuid not null,
  "rating" integer,
  "content" text,
  "images" text[],
  "created_at" timestamp with time zone default now() not null
);

create table public."article_versions" (
  "id" bigint generated always as identity not null,
  "article_id" bigint not null,
  "version" integer not null,
  "content_hash" text not null,
  "snapshot" jsonb not null,
  "client_request_id" text,
  "created_at" timestamp with time zone default now() not null
);

create table public."articles" (
  "id" bigint generated always as identity not null,
  "slug" text not null,
  "series_id" bigint,
  "type" text not null,
  "title" text not null,
  "summary" text,
  "cover_url" text,
  "tags" text[] default '{}'::text[] not null,
  "access" text default 'public'::text not null,
  "price" numeric(8,2),
  "preview_md" text default ''::text not null,
  "status" text default 'draft'::text not null,
  "featured" boolean default false not null,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "paused_at" timestamp with time zone,
  "sort_order" integer default 0 not null
);

create table public."avatar_cache" (
  "question_hash" text not null,
  "question_text" text not null,
  "answer_md" text not null,
  "sources" jsonb default '[]'::jsonb not null,
  "model" text not null,
  "hit_count" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."avatar_usage" (
  "id" bigint generated always as identity not null,
  "user_id" uuid,
  "ip" text,
  "model" text not null,
  "tokens_in" integer default 0 not null,
  "tokens_out" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."bookings" (
  "id" bigint generated always as identity not null,
  "service_id" bigint not null,
  "user_id" uuid,
  "email" text not null,
  "intent" text not null,
  "budget_range" text,
  "deadline" date,
  "context_links" text[],
  "agreement_snapshot" jsonb,
  "agreed_at" date,
  "status" text default 'inquiry'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "quote_snapshot" jsonb,
  "delivery_snapshot" jsonb,
  "revision_notes" jsonb default '[]'::jsonb not null,
  "agreement_sent_at" timestamp with time zone,
  "agreement_confirmed_at" timestamp with time zone
);

create table public."content_assets" (
  "scope" text not null,
  "path" text not null,
  "source_hash" text not null,
  "media" jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."content_file_revisions" (
  "id" bigint generated always as identity not null,
  "file_id" bigint not null,
  "version" integer not null,
  "input_hash" text not null,
  "snapshot" jsonb not null,
  "base_updated_at" timestamp with time zone,
  "request_id" text not null,
  "publication" jsonb,
  "published_updated_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);

create table public."content_files" (
  "id" bigint generated always as identity not null,
  "scope" text not null,
  "path" text not null,
  "article_slug" text not null,
  "sort" integer default 0 not null
);

create table public."conversation_messages" (
  "id" bigint generated always as identity not null,
  "conversation_id" bigint not null,
  "role" text not null,
  "content" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."conversations" (
  "id" bigint generated always as identity not null,
  "article_id" bigint,
  "user_id" uuid not null,
  "summary_md" text,
  "status" text default 'pending'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."custom_pages" (
  "id" bigint generated always as identity not null,
  "slug" text not null,
  "title" text not null,
  "description" text,
  "html" text default ''::text not null,
  "status" text default 'draft'::text not null,
  "nav_label" text,
  "nav_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "placement" text default 'none'::text not null
);

create table public."email_sends" (
  "id" bigint generated always as identity not null,
  "kind" text not null,
  "ref_id" text not null,
  "sent_to" text not null,
  "meta" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."entitlements" (
  "id" bigint generated always as identity not null,
  "user_id" uuid not null,
  "type" text not null,
  "target_id" bigint,
  "starts_at" timestamp with time zone default now() not null,
  "ends_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "source" text default 'order'::text not null,
  "source_ref" text,
  "created_at" timestamp with time zone default now() not null
);

create table public."evaluations" (
  "id" bigint generated always as identity not null,
  "booking_id" bigint not null,
  "rating" integer not null,
  "content" text,
  "created_at" timestamp with time zone default now() not null
);

create table public."event_details" (
  "series_id" bigint not null,
  "starts_at" timestamp with time zone not null,
  "location_text" text,
  "registration" text,
  "capacity" text,
  "kind" text default 'open'::text not null,
  "ticket_price" numeric(8,2),
  "state" text default 'upcoming'::text not null
);

create table public."inbox_items" (
  "id" bigint generated always as identity not null,
  "kind" text not null,
  "user_id" uuid,
  "contact" text,
  "payload" jsonb default '{}'::jsonb not null,
  "status" text default 'open'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."milestones" (
  "id" bigint generated always as identity not null,
  "booking_id" bigint not null,
  "title" text not null,
  "owner_party" text default 'owner'::text not null,
  "expected_at" date,
  "actual_at" date,
  "status" text default 'todo'::text not null,
  "sort" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "client_request" text,
  "client_requested_at" timestamp with time zone,
  "client_response" text,
  "client_responded_at" timestamp with time zone,
  "completion_note" text,
  "accepted_at" timestamp with time zone,
  "objection_note" text,
  "objected_at" timestamp with time zone,
  "events" jsonb default '[]'::jsonb not null
);

create table public."orders" (
  "id" bigint generated always as identity not null,
  "user_id" uuid not null,
  "sku_type" text not null,
  "target_id" bigint,
  "amount" numeric(10,2) not null,
  "status" text default 'pending'::text not null,
  "provider" text default 'zpay'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."payment_events" (
  "id" bigint generated always as identity not null,
  "provider" text default 'zpay'::text not null,
  "event_id" text not null,
  "payload" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."profiles" (
  "id" uuid not null,
  "handle" text,
  "is_owner" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "display_name" text
);

create table public."publish_requests" (
  "id" uuid default gen_random_uuid() not null,
  "client_request_id" text not null,
  "status" text not null,
  "response" jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."registrations" (
  "id" bigint generated always as identity not null,
  "series_id" bigint not null,
  "user_id" uuid,
  "email" text not null,
  "status" text default 'registered'::text not null,
  "checkin_token" uuid default gen_random_uuid() not null,
  "created_at" timestamp with time zone default now() not null
);

create table public."series" (
  "id" bigint generated always as identity not null,
  "slug" text not null,
  "type" text default 'handbook'::text not null,
  "title" text not null,
  "readme_article_id" bigint,
  "price" numeric(8,2) default 0 not null,
  "status" text default 'draft'::text not null,
  "tags" text[] default '{}'::text[] not null,
  "task" text,
  "audiences" text[] default '{}'::text[] not null,
  "featured" boolean default false not null,
  "paused_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."services" (
  "id" bigint generated always as identity not null,
  "slug" text not null,
  "title" text not null,
  "summary" text,
  "deliverables" text[] default '{}'::text[] not null,
  "duration" text,
  "price" numeric(10,2),
  "capacity_per_month" integer,
  "protocol_snapshot" jsonb,
  "status" text default 'draft'::text not null,
  "sort" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."site_config" (
  "id" integer default 1 not null,
  "site_name" text not null,
  "tagline" text,
  "owner_name" text not null,
  "footer_credit" boolean default true not null,
  "avatar_config" jsonb default '{}'::jsonb not null,
  "home_config" jsonb default '{}'::jsonb not null,
  "constraints" jsonb default '{}'::jsonb not null,
  "identity" jsonb default '{}'::jsonb not null,
  "contact" jsonb default '{}'::jsonb not null,
  "commerce" jsonb default '{}'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."site_secrets" (
  "key" text not null,
  "value" text not null,
  "updated_at" timestamp with time zone default now() not null
);

create table public."skill_details" (
  "series_id" bigint not null,
  "download_url" text,
  "file_manifest" jsonb
);

alter sequence public."article_chunks_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."article_reviews_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."article_versions_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."articles_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."avatar_usage_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."bookings_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."content_file_revisions_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."content_files_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."conversation_messages_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."conversations_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."custom_pages_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."email_sends_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."entitlements_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."evaluations_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."inbox_items_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."milestones_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."orders_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."payment_events_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."registrations_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."series_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter sequence public."services_id_seq" as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;

alter table public."app_schema_version" add constraint "app_schema_version_pkey" PRIMARY KEY (id);

alter table public."article_bodies" add constraint "article_bodies_pkey" PRIMARY KEY (article_id);

alter table public."article_chunks" add constraint "article_chunks_pkey" PRIMARY KEY (id);

alter table public."article_reviews" add constraint "article_reviews_pkey" PRIMARY KEY (id);

alter table public."article_versions" add constraint "article_versions_pkey" PRIMARY KEY (id);

alter table public."articles" add constraint "articles_pkey" PRIMARY KEY (id);

alter table public."avatar_cache" add constraint "avatar_cache_pkey" PRIMARY KEY (question_hash);

alter table public."avatar_usage" add constraint "avatar_usage_pkey" PRIMARY KEY (id);

alter table public."bookings" add constraint "bookings_pkey" PRIMARY KEY (id);

alter table public."content_assets" add constraint "content_assets_pkey" PRIMARY KEY (scope, path);

alter table public."content_file_revisions" add constraint "content_file_revisions_pkey" PRIMARY KEY (id);

alter table public."content_files" add constraint "content_files_pkey" PRIMARY KEY (id);

alter table public."conversation_messages" add constraint "conversation_messages_pkey" PRIMARY KEY (id);

alter table public."conversations" add constraint "conversations_pkey" PRIMARY KEY (id);

alter table public."custom_pages" add constraint "custom_pages_pkey" PRIMARY KEY (id);

alter table public."email_sends" add constraint "email_sends_pkey" PRIMARY KEY (id);

alter table public."entitlements" add constraint "entitlements_pkey" PRIMARY KEY (id);

alter table public."evaluations" add constraint "evaluations_pkey" PRIMARY KEY (id);

alter table public."event_details" add constraint "event_details_pkey" PRIMARY KEY (series_id);

alter table public."inbox_items" add constraint "inbox_items_pkey" PRIMARY KEY (id);

alter table public."milestones" add constraint "milestones_pkey" PRIMARY KEY (id);

alter table public."orders" add constraint "orders_pkey" PRIMARY KEY (id);

alter table public."payment_events" add constraint "payment_events_pkey" PRIMARY KEY (id);

alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);

alter table public."publish_requests" add constraint "publish_requests_pkey" PRIMARY KEY (id);

alter table public."registrations" add constraint "registrations_pkey" PRIMARY KEY (id);

alter table public."series" add constraint "series_pkey" PRIMARY KEY (id);

alter table public."services" add constraint "services_pkey" PRIMARY KEY (id);

alter table public."site_config" add constraint "site_config_pkey" PRIMARY KEY (id);

alter table public."site_secrets" add constraint "site_secrets_pkey" PRIMARY KEY (key);

alter table public."skill_details" add constraint "skill_details_pkey" PRIMARY KEY (series_id);

alter table public."article_chunks" add constraint "article_chunks_article_id_chunk_no_key" UNIQUE (article_id, chunk_no);

alter table public."article_versions" add constraint "article_versions_article_id_version_key" UNIQUE (article_id, version);

alter table public."articles" add constraint "articles_slug_key" UNIQUE (slug);

alter table public."content_file_revisions" add constraint "content_file_revisions_file_id_version_key" UNIQUE (file_id, version);

alter table public."content_file_revisions" add constraint "content_file_revisions_request_id_key" UNIQUE (request_id);

alter table public."content_files" add constraint "content_files_article_slug_key" UNIQUE (article_slug);

alter table public."content_files" add constraint "content_files_scope_path_key" UNIQUE (scope, path);

alter table public."custom_pages" add constraint "custom_pages_slug_key" UNIQUE (slug);

alter table public."email_sends" add constraint "email_sends_kind_ref_id_key" UNIQUE (kind, ref_id);

alter table public."evaluations" add constraint "evaluations_booking_id_key" UNIQUE (booking_id);

alter table public."payment_events" add constraint "payment_events_provider_event_id_key" UNIQUE (provider, event_id);

alter table public."profiles" add constraint "profiles_handle_key" UNIQUE (handle);

alter table public."publish_requests" add constraint "publish_requests_client_request_id_key" UNIQUE (client_request_id);

alter table public."registrations" add constraint "registrations_checkin_token_key" UNIQUE (checkin_token);

alter table public."registrations" add constraint "registrations_series_id_email_key" UNIQUE (series_id, email);

alter table public."series" add constraint "series_slug_key" UNIQUE (slug);

alter table public."services" add constraint "services_slug_key" UNIQUE (slug);

alter table public."app_schema_version" add constraint "app_schema_version_id_check" CHECK (id = 1);

alter table public."app_schema_version" add constraint "app_schema_version_version_check" CHECK (version ~ '^[0-9]{14}$'::text);

alter table public."article_chunks" add constraint "article_chunks_access_check" CHECK (access = ANY (ARRAY['public'::text, 'registered'::text, 'subscriber'::text, 'paid'::text]));

alter table public."article_chunks" add constraint "article_chunks_chunk_no_check" CHECK (chunk_no >= 0);

alter table public."article_chunks" add constraint "article_chunks_chunk_type_check" CHECK (chunk_type = ANY (ARRAY['catalog'::text, 'readme'::text, 'preview'::text, 'body'::text]));

alter table public."article_reviews" add constraint "article_reviews_rating_check" CHECK (rating IS NULL OR rating >= 1 AND rating <= 5);

alter table public."article_versions" add constraint "article_versions_version_check" CHECK (version > 0);

alter table public."articles" add constraint "article_container_check" CHECK (type = 'blog'::text AND series_id IS NULL OR type = 'chapter'::text AND series_id IS NOT NULL);

alter table public."articles" add constraint "article_price_check" CHECK (type = 'blog'::text AND access = 'paid'::text AND price IS NOT NULL AND price > 0::numeric OR type = 'blog'::text AND access <> 'paid'::text AND price IS NULL OR type = 'chapter'::text AND price IS NULL);

alter table public."articles" add constraint "article_publish_time_check" CHECK ((status <> ALL (ARRAY['published'::text, 'paused'::text])) OR published_at IS NOT NULL);

alter table public."articles" add constraint "articles_access_check" CHECK (access = ANY (ARRAY['public'::text, 'registered'::text, 'subscriber'::text, 'paid'::text]));

alter table public."articles" add constraint "articles_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text, 'archived'::text]));

alter table public."articles" add constraint "articles_type_check" CHECK (type = ANY (ARRAY['blog'::text, 'chapter'::text]));

alter table public."bookings" add constraint "bookings_status_check" CHECK (status = ANY (ARRAY['inquiry'::text, 'quoted'::text, 'booked'::text, 'in_progress'::text, 'delivered'::text, 'accepted'::text, 'settled'::text, 'declined'::text]));

alter table public."content_assets" add constraint "content_assets_path_check" CHECK (length(path) >= 1 AND length(path) <= 1024);

alter table public."content_assets" add constraint "content_assets_source_hash_check" CHECK (source_hash ~ '^[a-f0-9]{64}$'::text);

alter table public."content_file_revisions" add constraint "content_file_revisions_input_hash_check" CHECK (input_hash ~ '^[a-f0-9]{64}$'::text);

alter table public."content_file_revisions" add constraint "content_file_revisions_version_check" CHECK (version > 0);

alter table public."content_files" add constraint "content_files_path_check" CHECK (length(path) >= 1 AND length(path) <= 1024);

alter table public."conversation_messages" add constraint "conversation_messages_role_check" CHECK (role = ANY (ARRAY['user'::text, 'avatar'::text]));

alter table public."conversations" add constraint "conversations_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'public'::text, 'hidden'::text]));

alter table public."custom_pages" add constraint "custom_pages_placement_check" CHECK (placement = ANY (ARRAY['nav'::text, 'footer'::text, 'none'::text]));

alter table public."custom_pages" add constraint "custom_pages_slug_check" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'::text);

alter table public."custom_pages" add constraint "custom_pages_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text]));

alter table public."email_sends" add constraint "email_sends_kind_check" CHECK (kind = ANY (ARRAY['expiry_reminder'::text, 'archive_notice'::text, 'pause_notice'::text, 'avatar_alert'::text]));

alter table public."entitlements" add constraint "entitlement_target_check" CHECK (type = 'subscription'::text AND target_id IS NULL OR type <> 'subscription'::text AND target_id IS NOT NULL);

alter table public."entitlements" add constraint "entitlements_source_check" CHECK (source = ANY (ARRAY['order'::text, 'admin'::text, 'checkin'::text]));

alter table public."entitlements" add constraint "entitlements_type_check" CHECK (type = ANY (ARRAY['subscription'::text, 'series'::text, 'single'::text, 'event'::text]));

alter table public."evaluations" add constraint "evaluations_rating_check" CHECK (rating >= 1 AND rating <= 5);

alter table public."event_details" add constraint "event_details_kind_check" CHECK (kind = ANY (ARRAY['member'::text, 'open'::text]));

alter table public."event_details" add constraint "event_details_state_check" CHECK (state = ANY (ARRAY['upcoming'::text, 'registering'::text, 'ended'::text]));

alter table public."event_details" add constraint "event_details_ticket_price_check" CHECK (ticket_price IS NULL OR ticket_price >= 0::numeric);

alter table public."inbox_items" add constraint "inbox_items_kind_check" CHECK (kind = ANY (ARRAY['escalation'::text, 'inquiry'::text, 'booking_event'::text]));

alter table public."inbox_items" add constraint "inbox_items_status_check" CHECK (status = ANY (ARRAY['open'::text, 'done'::text]));

alter table public."milestones" add constraint "milestones_owner_party_check" CHECK (owner_party = ANY (ARRAY['owner'::text, 'client'::text, 'third'::text]));

alter table public."milestones" add constraint "milestones_status_check" CHECK (status = ANY (ARRAY['todo'::text, 'doing'::text, 'done'::text]));

alter table public."orders" add constraint "order_target_check" CHECK (sku_type = 'subscription'::text AND target_id IS NULL OR sku_type <> 'subscription'::text AND target_id IS NOT NULL);

alter table public."orders" add constraint "orders_amount_check" CHECK (amount >= 0::numeric);

alter table public."orders" add constraint "orders_provider_check" CHECK (provider = 'zpay'::text);

alter table public."orders" add constraint "orders_sku_type_check" CHECK (sku_type = ANY (ARRAY['subscription'::text, 'series'::text, 'single'::text, 'event'::text]));

alter table public."orders" add constraint "orders_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'paid'::text, 'fulfilled'::text, 'failed'::text, 'refunded'::text]));

alter table public."payment_events" add constraint "payment_events_provider_check" CHECK (provider = 'zpay'::text);

alter table public."profiles" add constraint "profiles_display_name_check" CHECK (display_name IS NULL OR char_length(display_name) >= 1 AND char_length(display_name) <= 40);

alter table public."publish_requests" add constraint "publish_requests_status_check" CHECK (status = ANY (ARRAY['pass'::text, 'needs_user_action'::text, 'blocked'::text]));

alter table public."registrations" add constraint "registrations_status_check" CHECK (status = ANY (ARRAY['registered'::text, 'attended'::text, 'cancelled'::text]));

alter table public."series" add constraint "series_price_check" CHECK (price >= 0::numeric);

alter table public."series" add constraint "series_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text, 'archived'::text]));

alter table public."series" add constraint "series_type_check" CHECK (type = ANY (ARRAY['handbook'::text, 'skill'::text, 'event'::text]));

alter table public."services" add constraint "published_service_has_price_check" CHECK (status <> 'published'::text OR price IS NOT NULL);

alter table public."services" add constraint "services_capacity_per_month_check" CHECK (capacity_per_month IS NULL OR capacity_per_month >= 0);

alter table public."services" add constraint "services_price_check" CHECK (price IS NULL OR price >= 0::numeric);

alter table public."services" add constraint "services_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'paused'::text, 'archived'::text]));

alter table public."site_config" add constraint "site_config_id_check" CHECK (id = 1);

alter table public."article_bodies" add constraint "article_bodies_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table public."article_chunks" add constraint "article_chunks_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table public."article_chunks" add constraint "article_chunks_series_id_fkey" FOREIGN KEY (series_id) REFERENCES series(id);

alter table public."article_reviews" add constraint "article_reviews_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table public."article_reviews" add constraint "article_reviews_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."article_versions" add constraint "article_versions_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;

alter table public."articles" add constraint "articles_series_id_fkey" FOREIGN KEY (series_id) REFERENCES series(id);

alter table public."avatar_usage" add constraint "avatar_usage_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public."bookings" add constraint "bookings_service_id_fkey" FOREIGN KEY (service_id) REFERENCES services(id);

alter table public."bookings" add constraint "bookings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public."content_file_revisions" add constraint "content_file_revisions_file_id_fkey" FOREIGN KEY (file_id) REFERENCES content_files(id) ON DELETE CASCADE;

alter table public."conversation_messages" add constraint "conversation_messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

alter table public."conversations" add constraint "conversations_article_id_fkey" FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL;

alter table public."conversations" add constraint "conversations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."entitlements" add constraint "entitlements_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."evaluations" add constraint "evaluations_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES bookings(id);

alter table public."event_details" add constraint "event_details_series_id_fkey" FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

alter table public."inbox_items" add constraint "inbox_items_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public."milestones" add constraint "milestones_booking_id_fkey" FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;

alter table public."orders" add constraint "orders_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

alter table public."registrations" add constraint "registrations_series_id_fkey" FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

alter table public."registrations" add constraint "registrations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

alter table public."series" add constraint "fk_series_readme" FOREIGN KEY (readme_article_id) REFERENCES articles(id);

alter table public."skill_details" add constraint "skill_details_series_id_fkey" FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

CREATE INDEX idx_articles_pub ON public.articles USING btree (status, type, published_at DESC);

CREATE INDEX idx_articles_series ON public.articles USING btree (series_id);

CREATE INDEX idx_avatar_usage_created ON public.avatar_usage USING btree (created_at);

CREATE INDEX idx_avatar_usage_user_day ON public.avatar_usage USING btree (user_id, created_at);

CREATE INDEX idx_chunks_vec ON public.article_chunks USING hnsw (embedding extensions.vector_cosine_ops);

CREATE INDEX idx_conv_article ON public.conversations USING btree (article_id) WHERE (status = 'public'::text);

CREATE INDEX idx_conv_msgs ON public.conversation_messages USING btree (conversation_id);

CREATE INDEX idx_custom_pages_nav ON public.custom_pages USING btree (placement, nav_order) WHERE ((status = 'published'::text) AND (placement <> 'none'::text));

CREATE INDEX idx_ent_user ON public.entitlements USING btree (user_id) WHERE (revoked_at IS NULL);

CREATE INDEX idx_inbox_items_status ON public.inbox_items USING btree (status, created_at DESC);

CREATE INDEX idx_milestones_booking ON public.milestones USING btree (booking_id);

CREATE UNIQUE INDEX idx_reviews_one_per_user ON public.article_reviews USING btree (article_id, user_id) WHERE (rating IS NOT NULL);

CREATE INDEX idx_series_type_status ON public.series USING btree (type, status, updated_at DESC);

CREATE UNIQUE INDEX idx_versions_request ON public.article_versions USING btree (client_request_id) WHERE (client_request_id IS NOT NULL);

CREATE UNIQUE INDEX one_owner_per_site ON public.profiles USING btree (is_owner) WHERE is_owner;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.profiles where id = auth.uid() and is_owner);
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  for r in
    select reg.id, reg.series_id from public.registrations reg
    where reg.user_id is null and lower(reg.email) = lower(new.email)
  loop
    update public.registrations set user_id = new.id where id = r.id;
    if r.series_id is not null then
      insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
      select new.id, 'event', r.series_id, null, 'checkin', 'checkin:' || r.id
      where r.id in (select id from public.registrations where status = 'attended')
        and coalesce((select ed.ticket_price from public.event_details ed where ed.series_id = r.series_id), 0) <= 0
        and not exists (
          select 1 from public.entitlements e
          where e.user_id = new.id and e.type = 'event' and e.target_id = r.series_id and e.revoked_at is null
        );
    end if;
  end loop;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.commit_publication(p_request_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  fm jsonb := p_payload->'frontmatter';
  item public.articles%rowtype;
  parent public.series%rowtype;
  latest public.article_versions%rowtype;
  diagnostics jsonb := coalesce(p_payload->'diagnostics', '[]'::jsonb);
  item_id bigint;
  next_version integer;
  detail text;
  content_url text;
  base text;
  paths jsonb;
  error_code text;
  error_message text;
begin
  perform pg_catalog.pg_advisory_xact_lock(71001, pg_catalog.hashtext(p_request_id));
  select response into result from public.publish_requests where client_request_id = p_request_id;
  if found then return result; end if;

  if p_payload->>'status' = 'blocked' then
    result := p_payload - 'status' || jsonb_build_object('status', 'blocked');
  else
    perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(fm->>'slug'));
    if fm->>'type' = 'chapter' then
      select * into parent from public.series where slug = fm->>'series_slug' for update;
      if not found then
        error_code := 'SERIES_NOT_FOUND'; error_message := '所属专辑不存在。';
      elsif parent.status = 'archived' then
        error_code := 'SCHEMA_INVALID'; error_message := '不能向已归档专辑发布。';
      end if;
    end if;
    select * into item from public.articles where slug = fm->>'slug' for update;
    if found and (item.status = 'archived' or item.type <> fm->>'type' or item.series_id is distinct from parent.id) then
      error_code := 'SCHEMA_INVALID'; error_message := '不能重发已归档文章或改变现有文章的类型和专辑归属。';
    end if;
    if p_payload ? 'expected_updated_at' and (item.id is null or item.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz) then
      error_code := 'SCHEMA_INVALID'; error_message := '内容已更新，请刷新后重试。';
    end if;
    if item.id is not null and parent.readme_article_id = item.id and fm->>'access' <> 'public' then
      error_code := 'SCHEMA_INVALID'; error_message := 'README 必须公开。';
    end if;
    if error_code is not null then
      diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', error_code, 'severity', 'error', 'message', error_message, 'path', '/frontmatter'));
      result := jsonb_build_object('status', 'blocked', 'diagnostics', diagnostics, 'article', null, 'revalidated', '[]'::jsonb);
    else
      if parent.price > 0 and fm->>'access' = 'subscriber' then
        diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', 'SUBSCRIBER_IN_PAID_SERIES', 'severity', 'warning', 'message', '订阅内容不参与专辑单卖。', 'path', '/frontmatter/access'));
      end if;
      if fm->>'type' = 'blog' then
        base := '/blog'; detail := base || '/' || (fm->>'slug');
      else
        base := case parent.type when 'handbook' then '/handbooks' when 'skill' then '/skills' else '/events' end;
        detail := base || '/' || parent.slug;
      end if;
      paths := jsonb_build_array('/', base, detail, '/llms.txt', '/card', '/card.json');
      content_url := detail || case when parent.id is not null then '?article=' || (fm->>'slug') else '' end;
      select * into latest from public.article_versions where article_id = item.id order by version desc limit 1;
      if latest.content_hash = p_payload->>'content_hash' then
        next_version := latest.version;
      else
        insert into public.articles (slug, series_id, type, title, summary, cover_url, tags, access, price, preview_md, status, published_at)
        values (fm->>'slug', parent.id, fm->>'type', fm->>'title', fm->>'summary', p_payload->>'cover',
          array(select jsonb_array_elements_text(coalesce(fm->'tags', '[]'::jsonb))), fm->>'access', (fm->>'price')::numeric,
          p_payload->>'preview', coalesce(nullif(item.status, 'draft'), 'published'), coalesce((fm->>'published_at')::timestamptz, item.published_at, now()))
        on conflict (slug) do update set title = excluded.title, summary = excluded.summary, cover_url = excluded.cover_url,
          tags = excluded.tags, access = excluded.access, price = excluded.price, preview_md = excluded.preview_md,
          status = excluded.status, published_at = excluded.published_at
        returning id into item_id;
        insert into public.article_bodies (article_id, content) values (item_id, p_payload->>'markdown')
          on conflict (article_id) do update set content = excluded.content;
        next_version := coalesce(latest.version, 0) + 1;
        insert into public.article_versions (article_id, version, content_hash, snapshot, client_request_id)
          values (item_id, next_version, p_payload->>'content_hash', p_payload->'snapshot', p_request_id);
        delete from public.article_chunks where article_id = item_id;
        insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
          values (item_id, parent.id, 'public', 'catalog', 0, (fm->>'title') || E'\n' || coalesce(fm->>'summary', ''), content_url);
        if fm->>'access' = 'public' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', case when parent.readme_article_id = item_id then 'readme' else 'body' end, 1, p_payload->>'markdown', content_url);
        elsif coalesce(p_payload->>'preview', '') <> '' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', 'preview', 1, p_payload->>'preview', content_url);
        end if;
      end if;
      result := jsonb_build_object('status', case when jsonb_array_length(diagnostics) > 0 then 'needs_user_action' else 'pass' end,
        'diagnostics', diagnostics, 'article', jsonb_build_object('slug', fm->>'slug', 'version', next_version,
          'url', content_url), 'revalidated', paths);
    end if;
  end if;
  insert into public.publish_requests (client_request_id, status, response) values (p_request_id, result->>'status', result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_content(p_kind text, p_id bigint, p_expected_updated_at timestamp with time zone, p_action text, p_value text, p_archive_notice boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  album public.series%rowtype;
  article public.articles%rowtype;
  old_status text;
  old_updated timestamptz;
  parent_id bigint;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '需要站主身份');
  end if;
  if p_kind = 'series' then
    select * into album from public.series where id = p_id for update;
    old_status := album.status; old_updated := album.updated_at;
  elsif p_kind = 'article' then
    select series_id into parent_id from public.articles where id = p_id;
    if parent_id is not null then
      select * into album from public.series where id = parent_id for update;
    end if;
    select * into article from public.articles where id = p_id for update;
    old_status := article.status; old_updated := article.updated_at;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的内容类型');
  end if;
  if old_status is null then
    return jsonb_build_object('ok', false, 'message', '内容不存在');
  end if;
  if p_expected_updated_at is null or old_updated <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'message', '内容已更新，请刷新后重试');
  end if;
  if old_status = 'archived' then
    return jsonb_build_object('ok', false, 'message', '归档内容不可修改或恢复');
  end if;
  if p_action = 'featured' then
    if p_value is null or p_value not in ('true','false') then
      return jsonb_build_object('ok',false,'message','置顶参数无效');
    end if;
    if p_kind = 'series' then update public.series set featured = p_value::boolean where id=p_id;
    else update public.articles set featured = p_value::boolean where id=p_id; end if;
  elsif p_action = 'price' and p_kind = 'series' then
    if album.type = 'event' then return jsonb_build_object('ok',false,'message','活动票价请在活动详情中修改'); end if;
    if p_value is null or p_value !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then return jsonb_build_object('ok',false,'message','价格需为 0–999999.99，最多两位小数'); end if;
    update public.series set price=p_value::numeric where id=p_id;
  elsif p_action = 'readme' and p_kind = 'series' then
    select * into article from public.articles where slug = p_value for update;
    if article.id is null or article.series_id is distinct from album.id
      or article.access <> 'public' or article.status not in ('published', 'paused') then
      return jsonb_build_object('ok', false, 'message', 'README 必须是本专辑已发布的公开章节');
    end if;
    update public.series set readme_article_id = article.id where id = p_id;
  elsif p_action = 'status' then
    if not ((old_status = 'published' and p_value = 'paused')
      or (old_status = 'paused' and p_value in ('published', 'archived'))
      or (p_kind = 'series' and old_status = 'draft' and p_value = 'published')) or p_value is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态变更；文章草稿请通过发布工作台发布');
    end if;
    if p_value = 'archived' then
      -- 归档静默（停售时已邮件通知）；时间闸：停售满 3 个月（权益保留期）才可归档。
      if p_archive_notice is distinct from true then
        return jsonb_build_object('ok', false, 'message', '请勾选确认归档');
      end if;
      if (case when p_kind = 'series' then album.paused_at else article.paused_at end) is null
         or (case when p_kind = 'series' then album.paused_at else article.paused_at end) > now() - interval '3 months' then
        return jsonb_build_object('ok', false, 'message', '停售满 3 个月后才可归档（已购权益保留期）');
      end if;
    end if;
    if p_kind = 'series' then
      if p_value = 'published' then
        select * into article from public.articles where id = album.readme_article_id for update;
        if article.id is null or article.series_id is distinct from album.id
          or article.access <> 'public' or article.status not in ('published', 'paused') then
          return jsonb_build_object('ok', false, 'message', '请先设置本专辑已发布的公开 README');
        end if;
        if album.type = 'event' and not exists(select 1 from public.event_details where series_id = album.id) then
          return jsonb_build_object('ok', false, 'message', '请先保存活动详情与票价');
        end if;
      end if;
      update public.series set status = p_value,
        paused_at = case p_value when 'paused' then now() when 'published' then null else paused_at end
      where id = p_id;
    else
      if p_value = 'archived' and album.readme_article_id = article.id and album.status <> 'archived' then
        return jsonb_build_object('ok', false, 'message', '此章节是专辑 README，请先更换 README 或归档专辑');
      end if;
      if p_value = 'published' and album.status = 'archived' then
        return jsonb_build_object('ok', false, 'message', '所属专辑已归档，不能恢复章节');
      end if;
      update public.articles set status = p_value,
        paused_at = case p_value when 'paused' then now() when 'published' then null else paused_at end
      where id = p_id;
    end if;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的操作');
  end if;
  return jsonb_build_object('ok', true, 'message', '已保存');
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_event_details(p_id bigint, p_expected_updated_at timestamp with time zone, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare album public.series%rowtype; previous public.event_details%rowtype; next_state text; price_text text; event_time timestamptz;
begin
  if not public.is_owner() then return jsonb_build_object('ok',false,'message','需要站主身份'); end if;
  select * into album from public.series where id=p_id for update;
  if album.id is null or album.type <> 'event' or album.status='archived' then return jsonb_build_object('ok',false,'message','仅可修改未归档的活动'); end if;
  if p_expected_updated_at is null or album.updated_at<>p_expected_updated_at then return jsonb_build_object('ok',false,'message','内容已更新，请刷新后重试'); end if;
  select * into previous from public.event_details where series_id=p_id for update;
  next_state := p_details->>'state'; price_text := p_details->>'ticket_price';
  if next_state is null or next_state not in ('upcoming','registering','ended') or coalesce(p_details->>'kind','') not in ('open','member')
    or price_text is null or price_text !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$'
    or length(coalesce(p_details->>'location_text',''))>500 or length(coalesce(p_details->>'registration',''))>3000 or length(coalesce(p_details->>'capacity',''))>200 then
    return jsonb_build_object('ok',false,'message','活动字段无效，请检查状态、票价和文字长度');
  end if;
  if (previous.series_id is null and next_state<>'upcoming') or (previous.series_id is not null and not (previous.state=next_state or (previous.state='upcoming' and next_state='registering') or (previous.state='registering' and next_state='ended'))) then
    return jsonb_build_object('ok',false,'message','活动按 即将开始 → 报名中 → 已结束 流转，不可倒退');
  end if;
  begin event_time := (p_details->>'starts_at')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'message','请输入有效活动时间'); end;
  if event_time is null or not isfinite(event_time) then return jsonb_build_object('ok',false,'message','请输入有效活动时间'); end if;
  insert into public.event_details(series_id,starts_at,location_text,registration,capacity,kind,ticket_price,state)
    values(p_id,event_time,nullif(p_details->>'location_text',''),nullif(p_details->>'registration',''),nullif(p_details->>'capacity',''),p_details->>'kind',price_text::numeric,next_state)
    on conflict(series_id) do update set starts_at=excluded.starts_at,location_text=excluded.location_text,registration=excluded.registration,capacity=excluded.capacity,kind=excluded.kind,ticket_price=excluded.ticket_price,state=excluded.state;
  update public.series set updated_at=now() where id=p_id;
  return jsonb_build_object('ok',true,'message','活动详情已保存');
end;
$function$;

CREATE OR REPLACE FUNCTION public.stage_content_file(p_scope text, p_path text, p_slug text, p_hash text, p_snapshot jsonb, p_expected bigint, p_request text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.content_files%rowtype; r public.content_file_revisions%rowtype; result bigint; base timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(71003, pg_catalog.hashtext(p_scope || '/' || p_path));
  select * into f from public.content_files where scope=p_scope and path=p_path for update;
  select * into r from public.content_file_revisions where file_id=f.id order by version desc limit 1;
  select updated_at into base from public.articles where slug=p_slug;
  if r.input_hash=p_hash and coalesce(r.published_updated_at,r.base_updated_at) is not distinct from base then return r.id; end if;
  if coalesce(r.id,0) <> p_expected then raise exception 'IMPORT_STALE'; end if;
  if f.id is not null and f.article_slug <> p_slug then raise exception 'IMPORT_SLUG_CHANGED'; end if;
  if f.id is null then
    insert into public.content_files(scope,path,article_slug,sort) values(p_scope,p_path,p_slug,(select coalesce(max(sort),0)+1 from public.content_files where scope=p_scope)) returning * into f;
  end if;
  select updated_at into base from public.articles where slug=p_slug;
  insert into public.content_file_revisions(file_id,version,input_hash,snapshot,base_updated_at,request_id)
    values(f.id,coalesce(r.version,0)+1,p_hash,p_snapshot,base,p_request) returning id into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.commit_file_publication(p_revision bigint, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.content_file_revisions%rowtype; f public.content_files%rowtype; online_updated timestamptz; result jsonb;
begin
  select * into r from public.content_file_revisions where id=p_revision for update;
  if not found then raise exception 'REVISION_NOT_FOUND'; end if;
  if r.publication is not null then return r.publication; end if;
  select * into f from public.content_files where id=r.file_id for update;
  -- Same lock ordering as publication; serialize against direct workbench updates too.
  perform pg_catalog.pg_advisory_xact_lock(71001, pg_catalog.hashtext(r.request_id));
  perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(f.article_slug));
  select updated_at into online_updated from public.articles where slug=f.article_slug;
  if online_updated is distinct from r.base_updated_at then
    return jsonb_build_object('status','blocked','diagnostics',jsonb_build_array(jsonb_build_object('code','SCHEMA_INVALID','severity','error','message','线上内容已变化，请重新导入并审核。','path','')),'article',null,'revalidated','[]'::jsonb);
  end if;
  if exists(select 1 from public.content_file_revisions where file_id=f.id and version>r.version) then
    return jsonb_build_object('status','blocked','diagnostics',jsonb_build_array(jsonb_build_object('code','SCHEMA_INVALID','severity','error','message','已有更新的待发布修订，请审核最新版本。','path','')),'article',null,'revalidated','[]'::jsonb);
  end if;
  result := public.commit_publication(r.request_id,p_payload);
  if result->>'status' <> 'blocked' then
    update public.articles set sort_order=f.sort where slug=f.article_slug and sort_order<>f.sort;
    update public.content_file_revisions set publication=result, published_updated_at=(select updated_at from public.articles where slug=f.article_slug) where id=r.id;
  end if;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.order_content_files(p_scope text, p_ids bigint[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item record; previous_updated timestamptz; next_updated timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(71004,pg_catalog.hashtext(p_scope));
  if cardinality(p_ids) <> (select count(*) from public.content_files where scope=p_scope)
    or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
    or exists(select 1 from unnest(p_ids) x where not exists(select 1 from public.content_files where id=x and scope=p_scope)) then
    raise exception 'ORDER_STALE';
  end if;
  for item in select id,position from unnest(p_ids) with ordinality as t(id,position) loop
    update public.content_files set sort=item.position where id=item.id;
    -- Reordering does not alter text, access or publication status.
    select updated_at into previous_updated from public.articles where slug=(select article_slug from public.content_files where id=item.id);
    update public.articles set sort_order=item.position where slug=(select article_slug from public.content_files where id=item.id) and sort_order<>item.position;
    select updated_at into next_updated from public.articles where slug=(select article_slug from public.content_files where id=item.id);
    update public.content_file_revisions set base_updated_at=next_updated where file_id=item.id and publication is null and base_updated_at=previous_updated;
    update public.content_file_revisions set published_updated_at=next_updated where file_id=item.id and publication is not null and published_updated_at=previous_updated;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.settle_payment(p_order_id bigint, p_event_id text, p_amount numeric, p_payload jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_duplicate boolean;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'EMPTY_EVENT';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select exists (
    select 1 from public.payment_events where provider = 'zpay' and event_id = p_event_id
  ) into v_duplicate;
  if v_duplicate then
    -- Replay of an event we already settled (or deliberately skipped): no side effects.
    return 'duplicate';
  end if;

  if v_order.status = 'paid' then
    -- A different event paying an already-paid order: record it, never grant twice.
    insert into public.payment_events (provider, event_id, payload)
    values ('zpay', p_event_id, coalesce(p_payload, '{}'::jsonb));
    return 'already_paid';
  end if;

  if p_amount is null or p_amount <> v_order.amount then
    -- Amount mismatch is rejected before anything is recorded (no trace left).
    raise exception 'AMOUNT_MISMATCH';
  end if;

  insert into public.payment_events (provider, event_id, payload)
  values ('zpay', p_event_id, coalesce(p_payload, '{}'::jsonb));

  update public.orders set status = 'paid'
  where id = p_order_id and status = 'pending';

  if v_order.sku_type = 'subscription' then
    insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
    select v_order.user_id, 'subscription', null, now() + interval '1 year', 'order', 'order:' || v_order.id
    where not exists (
      select 1 from public.entitlements e
      where e.user_id = v_order.user_id and e.type = 'subscription' and e.target_id is null
        and e.revoked_at is null and (e.ends_at is null or e.ends_at > now())
    );
  else
    insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
    select v_order.user_id, v_order.sku_type, v_order.target_id, null, 'order', 'order:' || v_order.id
    where not exists (
      select 1 from public.entitlements e
      where e.user_id = v_order.user_id and e.type = v_order.sku_type
        and e.target_id is not distinct from v_order.target_id
        and e.revoked_at is null and (e.ends_at is null or e.ends_at > now())
    );
  end if;

  return 'settled';
end $function$;

CREATE OR REPLACE FUNCTION public.match_chunks(p_embedding extensions.vector, p_limit integer DEFAULT 12)
 RETURNS TABLE(chunk_id bigint, article_id bigint, series_id bigint, access text, chunk_type text, chunk_no integer, content text, distance double precision)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select c.id, c.article_id, c.series_id, c.access, c.chunk_type, c.chunk_no, c.content,
         (c.embedding operator(extensions.<=>) p_embedding)::float
  from public.article_chunks c
  join public.articles a on a.id = c.article_id
  where c.embedding is not null and a.status in ('published', 'paused')
  order by c.embedding operator(extensions.<=>) p_embedding
  limit greatest(1, least(coalesce(p_limit, 12), 24))
$function$;

CREATE OR REPLACE FUNCTION public.manage_booking(p_id bigint, p_expected_updated_at timestamp with time zone, p_action text, p_value jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.bookings%rowtype;
  v_ms public.milestones%rowtype;
  v_next text;
  v_allowed boolean;
  v_item jsonb;
  v_price numeric;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '需要站主身份');
  end if;
  select * into b from public.bookings where id = p_id for update;
  if b.id is null then
    return jsonb_build_object('ok', false, 'message', '订单不存在');
  end if;
  if p_expected_updated_at is null or b.updated_at <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'message', '订单已更新，请刷新后重试');
  end if;

  if b.status in ('settled', 'declined') then
    return jsonb_build_object('ok', false, 'message', '已结束订单只读');
  end if;

  if p_action = 'status' then
    v_next := p_value->>'status';
    v_allowed := (b.status = 'inquiry' and v_next = 'declined')
      or (b.status = 'quoted' and v_next = 'declined')
      or (b.status = 'delivered' and v_next = 'in_progress')
      or (b.status = 'accepted' and v_next = 'settled');
    if b.status = 'booked' and v_next = 'in_progress' then
      if b.agreement_confirmed_at is null then
        return jsonb_build_object('ok', false, 'message', '条款尚未经客户确认，不能开工');
      end if;
      v_allowed := true;
    end if;
    if not v_allowed or v_next is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态流转（报价与交付请使用带内容的对应操作）');
    end if;
    update public.bookings set status = v_next, updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存');
  elsif p_action = 'quote' then
    if b.status not in ('inquiry', 'quoted') then
      return jsonb_build_object('ok', false, 'message', '当前状态不可报价');
    end if;
    if length(trim(coalesce(p_value->>'plan', ''))) < 10 then
      return jsonb_build_object('ok', false, 'message', '请填写方案要点（至少 10 字）');
    end if;
    if nullif(p_value->>'delivery_date', '') is null then
      return jsonb_build_object('ok', false, 'message', '请填写预计交付日期');
    end if;
    v_price := case when nullif(p_value->>'price', '') is not null then (p_value->>'price')::numeric else null end;
    if v_price is not null and (v_price < 0 or v_price > 99999999.99) then
      return jsonb_build_object('ok', false, 'message', '报价金额无效');
    end if;
    update public.bookings
      set status = 'quoted',
          quote_snapshot = jsonb_build_object('price', v_price, 'plan', left(trim(p_value->>'plan'), 2000),
            'delivery_date', (p_value->>'delivery_date')::date, 'quoted_at', now()),
          updated_at = now()
      where id = p_id;
    return jsonb_build_object('ok', true, 'message', '报价已发送，客户可在订单追踪页查看并接受。');
  elsif p_action = 'deliver' then
    if b.status <> 'in_progress' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可交付');
    end if;
    if length(trim(coalesce(p_value->>'note', ''))) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写交付说明（至少 5 字）');
    end if;
    update public.bookings
      set status = 'delivered',
          delivery_snapshot = jsonb_build_object('note', left(trim(p_value->>'note'), 2000),
            'links', coalesce(p_value->'links', '[]'::jsonb), 'delivered_at', now()),
          updated_at = now()
      where id = p_id;
    return jsonb_build_object('ok', true, 'message', '交付已提交，等待客户验收。');
  elsif p_action = 'book' then
    if b.status not in ('quoted', 'booked') then
      return jsonb_build_object('ok', false, 'message', '请先发送报价，再编辑条款');
    end if;
    if b.agreement_sent_at is not null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '条款已发送客户确认，不可再改（客户异议会退回草拟）');
    end if;
    if p_value->>'agreed_at' is null then
      return jsonb_build_object('ok', false, 'message', '请填写签约日期');
    end if;
    if exists (
      select 1 from (values ('party_owner'), ('party_client'), ('scope'), ('deliverable'), ('cadence'), ('compensation'), ('exit'), ('ownership')) keys(k)
      where length(trim(coalesce(p_value->'agreement'->>keys.k, ''))) = 0
    ) then
      return jsonb_build_object('ok', false, 'message', '条款需完整填写（双方主体/范围/交付/节奏/酬劳/退出/归属）');
    end if;
    update public.bookings
      set status = 'booked', agreement_snapshot = p_value->'agreement',
          agreed_at = (p_value->>'agreed_at')::date, updated_at = now()
      where id = p_id;
    if jsonb_array_length(coalesce(p_value->'milestones', '[]'::jsonb)) > 0 then
      for v_item in select value from jsonb_array_elements(p_value->'milestones') loop
        if length(trim(coalesce(v_item->>'title', ''))) > 0 then
          insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
          values (p_id, left(v_item->>'title', 200),
                  case when v_item->>'owner_party' in ('owner', 'client') then v_item->>'owner_party' else 'owner' end,
                  nullif(v_item->>'expected_at', '')::date,
                  coalesce((v_item->>'sort')::int, 0));
        end if;
      end loop;
    elsif not exists (select 1 from public.milestones where booking_id = p_id) then
      insert into public.milestones (booking_id, title, owner_party, sort)
        select p_id, left(d.item, 200), 'owner', d.ord - 1
        from public.services s, unnest(s.deliverables) with ordinality d(item, ord)
        where s.id = b.service_id;
    end if;
    return jsonb_build_object('ok', true, 'message', '条款草稿已保存；发送给客户确认后才能开工。');
  elsif p_action = 'send_agreement' then
    if b.status <> 'booked' or b.agreement_snapshot is null then
      return jsonb_build_object('ok', false, 'message', '请先保存条款草稿');
    end if;
    if b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '条款已确认');
    end if;
    if b.agreement_sent_at is not null then
      return jsonb_build_object('ok', false, 'message', '条款已发送，等待客户确认');
    end if;
    update public.bookings set agreement_sent_at = now(), updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '条款已发送，等待客户确认。');
  elsif p_action = 'milestone_add' then
    if b.status not in ('booked', 'in_progress') then
      return jsonb_build_object('ok', false, 'message', '仅成交或交付中的订单可添加检查点');
    end if;
    if length(trim(coalesce(p_value->>'title', ''))) = 0 then
      return jsonb_build_object('ok', false, 'message', '请填写检查点名称');
    end if;
    insert into public.milestones (booking_id, title, owner_party, expected_at, sort)
    values (p_id, left(p_value->>'title', 200),
            case when p_value->>'owner_party' in ('owner', 'client') then p_value->>'owner_party' else 'owner' end,
            nullif(p_value->>'expected_at', '')::date,
            coalesce((p_value->>'sort')::int, 0));
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已添加检查点');
  elsif p_action = 'milestone_update' then
    update public.milestones set
      actual_at = case when p_value ? 'actual_at' then nullif(p_value->>'actual_at', '')::date else actual_at end,
      owner_party = case when p_value->>'owner_party' in ('owner', 'client') then p_value->>'owner_party' else owner_party end,
      expected_at = case when p_value ? 'expected_at' then nullif(p_value->>'expected_at', '')::date else expected_at end
    where id = (p_value->>'id')::bigint and booking_id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '已保存检查点');
  elsif p_action = 'milestone_start' then
    if b.status <> 'in_progress' then
      return jsonb_build_object('ok', false, 'message', '请先确认条款并开工');
    end if;
    select * into v_ms from public.milestones where id = (p_value->>'id')::bigint and booking_id = p_id;
    if v_ms.id is null then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    if v_ms.status <> 'todo' then
      return jsonb_build_object('ok', false, 'message', '仅未开始的检查点可以启动');
    end if;
    if nullif(p_value->>'expected_at', '') is null then
      return jsonb_build_object('ok', false, 'message', '请填写预计完成日期');
    end if;
    update public.milestones set status = 'doing', expected_at = (p_value->>'expected_at')::date, owner_party = 'owner' where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '检查点已启动');
  elsif p_action = 'milestone_deliver' then
    if b.status <> 'in_progress' then
      return jsonb_build_object('ok', false, 'message', '请先确认条款并开工');
    end if;
    select * into v_ms from public.milestones where id = (p_value->>'id')::bigint and booking_id = p_id;
    if v_ms.id is null then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    if v_ms.status <> 'doing' then
      return jsonb_build_object('ok', false, 'message', '仅进行中的检查点可以交付');
    end if;
    if length(trim(coalesce(p_value->>'note', ''))) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写节点交付说明（至少 5 字）');
    end if;
    update public.milestones set
      status = 'done',
      actual_at = coalesce(actual_at, current_date),
      completion_note = left(trim(p_value->>'note'), 1000),
      accepted_at = null,
      objection_note = null,
      objected_at = null,
      owner_party = 'client',
      -- 交互留痕：交付事件追加，历史不覆盖
      events = events || jsonb_build_object('type', 'deliver', 'note', left(trim(p_value->>'note'), 1000), 'at', now())
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '节点已交付，等待客户验收。');
  elsif p_action = 'milestone_request' then
    if b.status not in ('booked', 'in_progress') then
      return jsonb_build_object('ok', false, 'message', '当前状态不可发请求');
    end if;
    select * into v_ms from public.milestones where id = (p_value->>'id')::bigint and booking_id = p_id;
    if v_ms.id is null then
      return jsonb_build_object('ok', false, 'message', '检查点不存在');
    end if;
    if v_ms.status <> 'doing' then
      return jsonb_build_object('ok', false, 'message', '请先启动检查点，再向客户请求支持');
    end if;
    if length(trim(coalesce(p_value->>'note', ''))) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写需求说明（至少 5 字）');
    end if;
    update public.milestones set
      client_request = left(trim(p_value->>'note'), 1000),
      client_requested_at = now(),
      client_response = null,
      client_responded_at = null,
      owner_party = 'client',
      events = events || jsonb_build_object('type', 'request', 'note', left(trim(p_value->>'note'), 1000), 'at', now())
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    return jsonb_build_object('ok', true, 'message', '请求已发送给客户');
  end if;
  return jsonb_build_object('ok', false, 'message', '不支持的操作');
end $function$;

CREATE OR REPLACE FUNCTION public.checkin_registration(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r public.registrations%rowtype;
  ev record;
  granted boolean := false;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '核销仅限站主操作');
  end if;
  select * into r from public.registrations where checkin_token = p_token for update;
  if r.id is null then
    return jsonb_build_object('ok', false, 'message', '核销链接无效');
  end if;
  if r.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'message', '该报名已取消');
  end if;
  if r.status = 'attended' then
    return jsonb_build_object('ok', true, 'message', '此前已核销', 'status', 'attended', 'granted', false);
  end if;
  update public.registrations set status = 'attended' where id = r.id;

  -- 免费活动：到场即发票（付费活动票随订单发放，此处不重复）；已有票/订阅者不重复发
  select ed.ticket_price into ev from public.event_details ed where ed.series_id = r.series_id;
  if r.user_id is not null and coalesce(ev.ticket_price, 0) <= 0 then
    insert into public.entitlements (user_id, type, target_id, ends_at, source, source_ref)
    select r.user_id, 'event', r.series_id, null, 'checkin', 'checkin:' || r.id
    where not exists (
      select 1 from public.entitlements e
      where e.user_id = r.user_id and e.type = 'event' and e.target_id = r.series_id
        and e.revoked_at is null and (e.ends_at is null or e.ends_at > now())
    );
    granted := found;
  end if;
  return jsonb_build_object('ok', true, 'message', case when granted then '已核销，纪要权限已开通' else '已核销' end, 'status', 'attended', 'granted', granted);
end $function$;

CREATE OR REPLACE FUNCTION public.client_respond_booking(p_id bigint, p_action text, p_value jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.bookings%rowtype;
  v_uid uuid := auth.uid();
  v_note text;
  v_label text;
  v_ms public.milestones%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'message', '请先登录');
  end if;
  select * into b from public.bookings where id = p_id for update;
  if b.id is null or b.user_id is distinct from v_uid then
    return jsonb_build_object('ok', false, 'message', '订单不存在');
  end if;

  if b.status in ('settled', 'declined') then
    return jsonb_build_object('ok', false, 'message', '已结束订单只读');
  end if;

  if p_action = 'accept_quote' then
    if b.status <> 'quoted' or b.quote_snapshot is null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可接受报价');
    end if;
    update public.bookings set status = 'booked', updated_at = now() where id = p_id;
    v_label := '客户已接受报价，订单成交';
  elsif p_action = 'decline_quote' then
    if b.status <> 'quoted' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可谢绝报价');
    end if;
    update public.bookings set status = 'declined', updated_at = now() where id = p_id;
    v_label := '客户谢绝了报价';
  elsif p_action = 'accept_agreement' then
    if b.status <> 'booked' or b.agreement_sent_at is null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可确认条款');
    end if;
    update public.bookings set agreement_confirmed_at = now(), updated_at = now() where id = p_id;
    v_label := '客户已确认条款，可以开工';
  elsif p_action = 'object_agreement' then
    if b.status <> 'booked' or b.agreement_sent_at is null or b.agreement_confirmed_at is not null then
      return jsonb_build_object('ok', false, 'message', '当前状态不可提出异议');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写异议说明（至少 5 字）');
    end if;
    update public.bookings
      set agreement_sent_at = null,
          revision_notes = revision_notes || jsonb_build_object('note', '条款异议：' || v_note, 'at', now()),
          updated_at = now()
      where id = p_id;
    v_label := '客户对条款提出异议：' || v_note;
  elsif p_action = 'respond_milestone' then
    select * into v_ms from public.milestones where id = (p_value->>'milestone_id')::bigint and booking_id = p_id;
    if v_ms.id is null or v_ms.client_request is null then
      return jsonb_build_object('ok', false, 'message', '该检查点没有待反馈的请求');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 1 then
      return jsonb_build_object('ok', false, 'message', '请填写反馈内容');
    end if;
    update public.milestones set
      client_response = v_note,
      client_responded_at = now(),
      owner_party = 'owner',
      events = events || jsonb_build_object('type', 'response', 'note', v_note, 'at', now())
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    v_label := '客户反馈了检查点「' || v_ms.title || '」：' || v_note;
  elsif p_action = 'accept_milestone' then
    select * into v_ms from public.milestones where id = (p_value->>'milestone_id')::bigint and booking_id = p_id;
    if v_ms.id is null or v_ms.status <> 'done' or v_ms.accepted_at is not null then
      return jsonb_build_object('ok', false, 'message', '该检查点当前不可验收');
    end if;
    update public.milestones set
      accepted_at = now(), owner_party = 'owner',
      events = events || jsonb_build_object('type', 'accept', 'at', now())
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    v_label := '客户已验收检查点「' || v_ms.title || '」';
  elsif p_action = 'object_milestone' then
    select * into v_ms from public.milestones where id = (p_value->>'milestone_id')::bigint and booking_id = p_id;
    if v_ms.id is null or v_ms.status <> 'done' or v_ms.accepted_at is not null then
      return jsonb_build_object('ok', false, 'message', '该检查点当前不可驳回');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写驳回意见（至少 5 字）');
    end if;
    update public.milestones set
      status = 'doing',
      objection_note = v_note,
      objected_at = now(),
      owner_party = 'owner',
      events = events || jsonb_build_object('type', 'objection', 'note', v_note, 'at', now())
    where id = v_ms.id;
    update public.bookings set updated_at = now() where id = p_id;
    v_label := '客户驳回了检查点「' || v_ms.title || '」：' || v_note;
  elsif p_action = 'accept_delivery' then
    if b.status <> 'delivered' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可验收');
    end if;
    update public.bookings set status = 'accepted', updated_at = now() where id = p_id;
    v_label := '客户已验收交付';
  elsif p_action = 'request_revision' then
    if b.status <> 'delivered' then
      return jsonb_build_object('ok', false, 'message', '当前状态不可要求修改');
    end if;
    v_note := left(trim(coalesce(p_value->>'note', '')), 1000);
    if length(v_note) < 5 then
      return jsonb_build_object('ok', false, 'message', '请填写修改意见（至少 5 字）');
    end if;
    update public.bookings
      set status = 'in_progress',
          revision_notes = revision_notes || jsonb_build_object('note', v_note, 'at', now()),
          updated_at = now()
      where id = p_id;
    v_label := '客户要求修改：' || v_note;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的操作');
  end if;

  insert into public.inbox_items (kind, user_id, contact, payload)
    values ('booking_event', v_uid, b.email,
      jsonb_build_object('message', v_label, 'booking_id', b.id, 'action', p_action));
  return jsonb_build_object('ok', true, 'message', '已提交');
end $function$;

CREATE OR REPLACE FUNCTION public.set_display_name(p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.claim_owner_for(p_user_id uuid, p_expected_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

create view public."content_file_heads" with (security_invoker=true) as SELECT DISTINCT ON (file_id) id,
    file_id,
    version,
    input_hash,
    publication,
    created_at
   FROM content_file_revisions
  ORDER BY file_id, version DESC;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE TRIGGER trg_articles_updated BEFORE UPDATE ON articles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_series_updated BEFORE UPDATE ON series FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_site_config_updated BEFORE UPDATE ON site_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table public."app_schema_version" enable row level security;

alter table public."article_bodies" enable row level security;

alter table public."article_chunks" enable row level security;

alter table public."article_reviews" enable row level security;

alter table public."article_versions" enable row level security;

alter table public."articles" enable row level security;

alter table public."avatar_cache" enable row level security;

alter table public."avatar_usage" enable row level security;

alter table public."bookings" enable row level security;

alter table public."content_assets" enable row level security;

alter table public."content_file_revisions" enable row level security;

alter table public."content_files" enable row level security;

alter table public."conversation_messages" enable row level security;

alter table public."conversations" enable row level security;

alter table public."custom_pages" enable row level security;

alter table public."email_sends" enable row level security;

alter table public."entitlements" enable row level security;

alter table public."evaluations" enable row level security;

alter table public."event_details" enable row level security;

alter table public."inbox_items" enable row level security;

alter table public."milestones" enable row level security;

alter table public."orders" enable row level security;

alter table public."payment_events" enable row level security;

alter table public."profiles" enable row level security;

alter table public."publish_requests" enable row level security;

alter table public."registrations" enable row level security;

alter table public."series" enable row level security;

alter table public."services" enable row level security;

alter table public."site_config" enable row level security;

alter table public."site_secrets" enable row level security;

alter table public."skill_details" enable row level security;

create policy "app_schema_version_service_read" on public."app_schema_version" as permissive for select to "service_role" using (true);

create policy "bodies_read" on public."article_bodies" as permissive for select to PUBLIC using (is_owner() OR (EXISTS ( SELECT 1
   FROM articles a
  WHERE a.id = article_bodies.article_id AND (a.status = ANY (ARRAY['published'::text, 'paused'::text])) AND ((EXISTS ( SELECT 1
           FROM series s
          WHERE s.readme_article_id = a.id AND (s.status = ANY (ARRAY['published'::text, 'paused'::text])))) OR a.access = 'public'::text OR a.access = 'registered'::text AND auth.uid() IS NOT NULL OR a.access = 'subscriber'::text AND auth.uid() IS NOT NULL AND (EXISTS ( SELECT 1
           FROM entitlements e
          WHERE e.user_id = auth.uid() AND e.revoked_at IS NULL AND (e.ends_at IS NULL OR e.ends_at > now()) AND (e.type = 'subscription'::text OR e.type = 'event'::text AND e.target_id = a.series_id))) OR a.access = 'paid'::text AND auth.uid() IS NOT NULL AND (EXISTS ( SELECT 1
           FROM entitlements e
          WHERE e.user_id = auth.uid() AND e.revoked_at IS NULL AND (e.ends_at IS NULL OR e.ends_at > now()) AND (e.type = 'subscription'::text OR e.type = 'series'::text AND e.target_id = a.series_id OR e.type = 'single'::text AND e.target_id = a.id)))))));

create policy "chunks_read" on public."article_chunks" as permissive for select to PUBLIC using (is_owner() OR (EXISTS ( SELECT 1
   FROM articles a
  WHERE a.id = article_chunks.article_id AND (a.status = ANY (ARRAY['published'::text, 'paused'::text])) AND ((article_chunks.chunk_type = ANY (ARRAY['catalog'::text, 'readme'::text, 'preview'::text])) OR a.access = 'public'::text OR a.access = 'registered'::text AND auth.uid() IS NOT NULL OR a.access = 'subscriber'::text AND auth.uid() IS NOT NULL AND (EXISTS ( SELECT 1
           FROM entitlements e
          WHERE e.user_id = auth.uid() AND e.revoked_at IS NULL AND (e.ends_at IS NULL OR e.ends_at > now()) AND (e.type = 'subscription'::text OR e.type = 'event'::text AND e.target_id = a.series_id))) OR a.access = 'paid'::text AND auth.uid() IS NOT NULL AND (EXISTS ( SELECT 1
           FROM entitlements e
          WHERE e.user_id = auth.uid() AND e.revoked_at IS NULL AND (e.ends_at IS NULL OR e.ends_at > now()) AND (e.type = 'subscription'::text OR e.type = 'series'::text AND e.target_id = a.series_id OR e.type = 'single'::text AND e.target_id = a.id)))))));

create policy "reviews_public_read" on public."article_reviews" as permissive for select to PUBLIC using (true);

create policy "versions_owner_read" on public."article_versions" as permissive for select to PUBLIC using (is_owner());

create policy "articles_owner_update" on public."articles" as permissive for update to PUBLIC using (is_owner()) with check (is_owner());

create policy "articles_read" on public."articles" as permissive for select to PUBLIC using (is_owner() OR (status = ANY (ARRAY['published'::text, 'paused'::text])));

create policy "avatar_cache_owner_read" on public."avatar_cache" as permissive for select to PUBLIC using (is_owner());

create policy "avatar_usage_owner_read" on public."avatar_usage" as permissive for select to PUBLIC using (is_owner());

create policy "avatar_usage_self_read" on public."avatar_usage" as permissive for select to PUBLIC using (user_id = auth.uid());

create policy "bookings_own_read" on public."bookings" as permissive for select to PUBLIC using (user_id = auth.uid() OR is_owner());

create policy "content_assets_owner_read" on public."content_assets" as permissive for select to "authenticated" using (( SELECT is_owner() AS is_owner));

create policy "content_revisions_owner_read" on public."content_file_revisions" as permissive for select to "authenticated" using (( SELECT is_owner() AS is_owner));

create policy "content_files_owner_read" on public."content_files" as permissive for select to "authenticated" using (( SELECT is_owner() AS is_owner));

create policy "conversation_messages_own_insert" on public."conversation_messages" as permissive for insert to PUBLIC with check (role = 'user'::text AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE c.id = conversation_messages.conversation_id AND c.user_id = auth.uid() AND (c.status = ANY (ARRAY['pending'::text, 'public'::text])))));

create policy "conversation_messages_read" on public."conversation_messages" as permissive for select to PUBLIC using ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE c.id = conversation_messages.conversation_id AND (c.user_id = auth.uid() OR is_owner() OR c.status = 'public'::text))));

create policy "conversations_own_insert" on public."conversations" as permissive for insert to PUBLIC with check (user_id = auth.uid() AND status = 'pending'::text AND (article_id IS NULL OR (EXISTS ( SELECT 1
   FROM articles a
  WHERE a.id = conversations.article_id AND (a.status = ANY (ARRAY['published'::text, 'paused'::text]))))));

create policy "conversations_own_read" on public."conversations" as permissive for select to PUBLIC using (user_id = auth.uid() OR is_owner() OR status = 'public'::text);

create policy "conversations_owner_review" on public."conversations" as permissive for update to PUBLIC using (is_owner()) with check (is_owner());

create policy "custom_pages_owner_all" on public."custom_pages" as permissive for all to PUBLIC using (is_owner()) with check (is_owner());

create policy "custom_pages_public_read" on public."custom_pages" as permissive for select to PUBLIC using (status = 'published'::text);

create policy "email_sends_owner_read" on public."email_sends" as permissive for select to PUBLIC using (is_owner());

create policy "entitlements_own_read" on public."entitlements" as permissive for select to PUBLIC using (user_id = auth.uid() OR is_owner());

create policy "entitlements_owner_insert" on public."entitlements" as permissive for insert to PUBLIC with check (is_owner());

create policy "evaluations_public_read" on public."evaluations" as permissive for select to PUBLIC using (true);

create policy "event_details_owner_write" on public."event_details" as permissive for all to PUBLIC using (is_owner()) with check (is_owner());

create policy "event_details_read" on public."event_details" as permissive for select to PUBLIC using (is_owner() OR (EXISTS ( SELECT 1
   FROM series s
  WHERE s.id = event_details.series_id AND (s.status = ANY (ARRAY['published'::text, 'paused'::text])))));

create policy "inbox_items_owner_read" on public."inbox_items" as permissive for select to PUBLIC using (is_owner());

create policy "inbox_items_owner_update" on public."inbox_items" as permissive for update to PUBLIC using (is_owner()) with check (is_owner());

create policy "milestones_read" on public."milestones" as permissive for select to PUBLIC using ((EXISTS ( SELECT 1
   FROM bookings b
  WHERE b.id = milestones.booking_id AND (b.user_id = auth.uid() OR is_owner()))));

create policy "orders_own_read" on public."orders" as permissive for select to PUBLIC using (user_id = auth.uid() OR is_owner());

create policy "payment_events_owner_read" on public."payment_events" as permissive for select to PUBLIC using (is_owner());

create policy "profiles_owner_read" on public."profiles" as permissive for select to PUBLIC using (is_owner());

create policy "profiles_self_read" on public."profiles" as permissive for select to PUBLIC using (id = auth.uid());

create policy "publish_requests_owner_read" on public."publish_requests" as permissive for select to PUBLIC using (is_owner());

create policy "registrations_own_read" on public."registrations" as permissive for select to PUBLIC using (user_id = auth.uid() OR is_owner());

create policy "registrations_owner_update" on public."registrations" as permissive for update to PUBLIC using (is_owner()) with check (is_owner());

create policy "series_owner_insert" on public."series" as permissive for insert to PUBLIC with check (is_owner());

create policy "series_owner_update" on public."series" as permissive for update to PUBLIC using (is_owner()) with check (is_owner());

create policy "series_read" on public."series" as permissive for select to PUBLIC using (is_owner() OR (status = ANY (ARRAY['published'::text, 'paused'::text])));

create policy "services_owner_write" on public."services" as permissive for all to PUBLIC using (is_owner()) with check (is_owner());

create policy "services_read" on public."services" as permissive for select to PUBLIC using (is_owner() OR (status = ANY (ARRAY['published'::text, 'paused'::text])));

create policy "site_config_owner_update" on public."site_config" as permissive for update to PUBLIC using (is_owner()) with check (is_owner());

create policy "site_config_read" on public."site_config" as permissive for select to PUBLIC using (true);

create policy "site_secrets_owner_all" on public."site_secrets" as permissive for all to PUBLIC using (is_owner()) with check (is_owner());

create policy "skill_details_read" on public."skill_details" as permissive for select to PUBLIC using (is_owner() OR (EXISTS ( SELECT 1
   FROM series s
  WHERE s.id = skill_details.series_id AND (s.status = ANY (ARRAY['published'::text, 'paused'::text])))));

revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;

revoke all on function public.is_owner() from public, anon, authenticated, service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

revoke all on function public.commit_publication(text, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.manage_content(text, bigint, timestamp with time zone, text, text, boolean) from public, anon, authenticated, service_role;

revoke all on function public.save_event_details(bigint, timestamp with time zone, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.stage_content_file(text, text, text, text, jsonb, bigint, text) from public, anon, authenticated, service_role;

revoke all on function public.commit_file_publication(bigint, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.order_content_files(text, bigint[]) from public, anon, authenticated, service_role;

revoke all on function public.settle_payment(bigint, text, numeric, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.match_chunks(extensions.vector, integer) from public, anon, authenticated, service_role;

revoke all on function public.manage_booking(bigint, timestamp with time zone, text, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.checkin_registration(uuid) from public, anon, authenticated, service_role;

revoke all on function public.client_respond_booking(bigint, text, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.set_display_name(text) from public, anon, authenticated, service_role;

revoke all on function public.claim_owner_for(uuid, text) from public, anon, authenticated, service_role;

revoke all on table public."app_schema_version" from public, anon, authenticated, service_role;

revoke all on table public."article_bodies" from public, anon, authenticated, service_role;

revoke all on table public."article_chunks" from public, anon, authenticated, service_role;

revoke all on table public."article_reviews" from public, anon, authenticated, service_role;

revoke all on table public."article_versions" from public, anon, authenticated, service_role;

revoke all on table public."articles" from public, anon, authenticated, service_role;

revoke all on table public."avatar_cache" from public, anon, authenticated, service_role;

revoke all on table public."avatar_usage" from public, anon, authenticated, service_role;

revoke all on table public."bookings" from public, anon, authenticated, service_role;

revoke all on table public."content_assets" from public, anon, authenticated, service_role;

revoke all on table public."content_file_revisions" from public, anon, authenticated, service_role;

revoke all on table public."content_files" from public, anon, authenticated, service_role;

revoke all on table public."conversation_messages" from public, anon, authenticated, service_role;

revoke all on table public."conversations" from public, anon, authenticated, service_role;

revoke all on table public."custom_pages" from public, anon, authenticated, service_role;

revoke all on table public."email_sends" from public, anon, authenticated, service_role;

revoke all on table public."entitlements" from public, anon, authenticated, service_role;

revoke all on table public."evaluations" from public, anon, authenticated, service_role;

revoke all on table public."event_details" from public, anon, authenticated, service_role;

revoke all on table public."inbox_items" from public, anon, authenticated, service_role;

revoke all on table public."milestones" from public, anon, authenticated, service_role;

revoke all on table public."orders" from public, anon, authenticated, service_role;

revoke all on table public."payment_events" from public, anon, authenticated, service_role;

revoke all on table public."profiles" from public, anon, authenticated, service_role;

revoke all on table public."publish_requests" from public, anon, authenticated, service_role;

revoke all on table public."registrations" from public, anon, authenticated, service_role;

revoke all on table public."series" from public, anon, authenticated, service_role;

revoke all on table public."services" from public, anon, authenticated, service_role;

revoke all on table public."site_config" from public, anon, authenticated, service_role;

revoke all on table public."site_secrets" from public, anon, authenticated, service_role;

revoke all on table public."skill_details" from public, anon, authenticated, service_role;

revoke all on table public."content_file_heads" from public, anon, authenticated, service_role;

revoke all on sequence public."article_chunks_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."article_reviews_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."article_versions_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."articles_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."avatar_usage_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."bookings_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."content_file_revisions_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."content_files_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."conversation_messages_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."conversations_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."custom_pages_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."email_sends_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."entitlements_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."evaluations_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."inbox_items_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."milestones_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."orders_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."payment_events_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."registrations_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."series_id_seq" from public, anon, authenticated, service_role;

revoke all on sequence public."services_id_seq" from public, anon, authenticated, service_role;

grant EXECUTE on function public.checkin_registration(uuid) to "authenticated";

grant EXECUTE on function public.checkin_registration(uuid) to "service_role";

grant EXECUTE on function public.claim_owner_for(uuid, text) to "service_role";

grant EXECUTE on function public.client_respond_booking(bigint, text, jsonb) to "authenticated";

grant EXECUTE on function public.commit_file_publication(bigint, jsonb) to "service_role";

grant EXECUTE on function public.commit_publication(text, jsonb) to "service_role";

grant EXECUTE on function public.is_owner() to "anon";

grant EXECUTE on function public.is_owner() to "authenticated";

grant EXECUTE on function public.is_owner() to "service_role";

grant EXECUTE on function public.manage_booking(bigint, timestamp with time zone, text, jsonb) to "authenticated";

grant EXECUTE on function public.manage_content(text, bigint, timestamp with time zone, text, text, boolean) to "authenticated";

grant EXECUTE on function public.match_chunks(extensions.vector, integer) to "service_role";

grant EXECUTE on function public.order_content_files(text, bigint[]) to "service_role";

grant EXECUTE on function public.save_event_details(bigint, timestamp with time zone, jsonb) to "authenticated";

grant EXECUTE on function public.set_display_name(text) to "authenticated";

grant EXECUTE on function public.settle_payment(bigint, text, numeric, jsonb) to "service_role";

grant EXECUTE on function public.stage_content_file(text, text, text, text, jsonb, bigint, text) to "service_role";

grant SELECT on table public."app_schema_version" to "service_role";

grant SELECT on table public."article_bodies" to "anon";

grant SELECT on table public."article_bodies" to "authenticated";

grant DELETE on table public."article_bodies" to "service_role";

grant INSERT on table public."article_bodies" to "service_role";

grant MAINTAIN on table public."article_bodies" to "service_role";

grant REFERENCES on table public."article_bodies" to "service_role";

grant SELECT on table public."article_bodies" to "service_role";

grant TRIGGER on table public."article_bodies" to "service_role";

grant TRUNCATE on table public."article_bodies" to "service_role";

grant UPDATE on table public."article_bodies" to "service_role";

grant SELECT on table public."article_chunks" to "anon";

grant SELECT on table public."article_chunks" to "authenticated";

grant DELETE on table public."article_chunks" to "service_role";

grant INSERT on table public."article_chunks" to "service_role";

grant MAINTAIN on table public."article_chunks" to "service_role";

grant REFERENCES on table public."article_chunks" to "service_role";

grant SELECT on table public."article_chunks" to "service_role";

grant TRIGGER on table public."article_chunks" to "service_role";

grant TRUNCATE on table public."article_chunks" to "service_role";

grant UPDATE on table public."article_chunks" to "service_role";

grant SELECT on sequence public."article_chunks_id_seq" to "service_role";

grant USAGE on sequence public."article_chunks_id_seq" to "service_role";

grant SELECT on table public."article_reviews" to "anon";

grant SELECT on table public."article_reviews" to "authenticated";

grant DELETE on table public."article_reviews" to "service_role";

grant INSERT on table public."article_reviews" to "service_role";

grant MAINTAIN on table public."article_reviews" to "service_role";

grant REFERENCES on table public."article_reviews" to "service_role";

grant SELECT on table public."article_reviews" to "service_role";

grant TRIGGER on table public."article_reviews" to "service_role";

grant TRUNCATE on table public."article_reviews" to "service_role";

grant UPDATE on table public."article_reviews" to "service_role";

grant SELECT on sequence public."article_reviews_id_seq" to "service_role";

grant USAGE on sequence public."article_reviews_id_seq" to "service_role";

grant SELECT on table public."article_versions" to "authenticated";

grant DELETE on table public."article_versions" to "service_role";

grant INSERT on table public."article_versions" to "service_role";

grant MAINTAIN on table public."article_versions" to "service_role";

grant REFERENCES on table public."article_versions" to "service_role";

grant SELECT on table public."article_versions" to "service_role";

grant TRIGGER on table public."article_versions" to "service_role";

grant TRUNCATE on table public."article_versions" to "service_role";

grant UPDATE on table public."article_versions" to "service_role";

grant SELECT on sequence public."article_versions_id_seq" to "service_role";

grant USAGE on sequence public."article_versions_id_seq" to "service_role";

grant SELECT on table public."articles" to "anon";

grant SELECT on table public."articles" to "authenticated";

grant UPDATE on table public."articles" to "authenticated";

grant DELETE on table public."articles" to "service_role";

grant INSERT on table public."articles" to "service_role";

grant MAINTAIN on table public."articles" to "service_role";

grant REFERENCES on table public."articles" to "service_role";

grant SELECT on table public."articles" to "service_role";

grant TRIGGER on table public."articles" to "service_role";

grant TRUNCATE on table public."articles" to "service_role";

grant UPDATE on table public."articles" to "service_role";

grant SELECT on sequence public."articles_id_seq" to "service_role";

grant USAGE on sequence public."articles_id_seq" to "service_role";

grant SELECT on table public."avatar_cache" to "authenticated";

grant DELETE on table public."avatar_cache" to "service_role";

grant INSERT on table public."avatar_cache" to "service_role";

grant MAINTAIN on table public."avatar_cache" to "service_role";

grant REFERENCES on table public."avatar_cache" to "service_role";

grant SELECT on table public."avatar_cache" to "service_role";

grant TRIGGER on table public."avatar_cache" to "service_role";

grant TRUNCATE on table public."avatar_cache" to "service_role";

grant UPDATE on table public."avatar_cache" to "service_role";

grant SELECT on table public."avatar_usage" to "authenticated";

grant DELETE on table public."avatar_usage" to "service_role";

grant INSERT on table public."avatar_usage" to "service_role";

grant MAINTAIN on table public."avatar_usage" to "service_role";

grant REFERENCES on table public."avatar_usage" to "service_role";

grant SELECT on table public."avatar_usage" to "service_role";

grant TRIGGER on table public."avatar_usage" to "service_role";

grant TRUNCATE on table public."avatar_usage" to "service_role";

grant UPDATE on table public."avatar_usage" to "service_role";

grant SELECT on sequence public."avatar_usage_id_seq" to "service_role";

grant USAGE on sequence public."avatar_usage_id_seq" to "service_role";

grant SELECT on table public."bookings" to "authenticated";

grant DELETE on table public."bookings" to "service_role";

grant INSERT on table public."bookings" to "service_role";

grant MAINTAIN on table public."bookings" to "service_role";

grant REFERENCES on table public."bookings" to "service_role";

grant SELECT on table public."bookings" to "service_role";

grant TRIGGER on table public."bookings" to "service_role";

grant TRUNCATE on table public."bookings" to "service_role";

grant UPDATE on table public."bookings" to "service_role";

grant SELECT on sequence public."bookings_id_seq" to "service_role";

grant USAGE on sequence public."bookings_id_seq" to "service_role";

grant SELECT on table public."content_assets" to "authenticated";

grant DELETE on table public."content_assets" to "service_role";

grant INSERT on table public."content_assets" to "service_role";

grant MAINTAIN on table public."content_assets" to "service_role";

grant REFERENCES on table public."content_assets" to "service_role";

grant SELECT on table public."content_assets" to "service_role";

grant TRIGGER on table public."content_assets" to "service_role";

grant TRUNCATE on table public."content_assets" to "service_role";

grant UPDATE on table public."content_assets" to "service_role";

grant SELECT on table public."content_file_heads" to "authenticated";

grant DELETE on table public."content_file_heads" to "service_role";

grant INSERT on table public."content_file_heads" to "service_role";

grant MAINTAIN on table public."content_file_heads" to "service_role";

grant REFERENCES on table public."content_file_heads" to "service_role";

grant SELECT on table public."content_file_heads" to "service_role";

grant TRIGGER on table public."content_file_heads" to "service_role";

grant TRUNCATE on table public."content_file_heads" to "service_role";

grant UPDATE on table public."content_file_heads" to "service_role";

grant SELECT on table public."content_file_revisions" to "authenticated";

grant DELETE on table public."content_file_revisions" to "service_role";

grant INSERT on table public."content_file_revisions" to "service_role";

grant MAINTAIN on table public."content_file_revisions" to "service_role";

grant REFERENCES on table public."content_file_revisions" to "service_role";

grant SELECT on table public."content_file_revisions" to "service_role";

grant TRIGGER on table public."content_file_revisions" to "service_role";

grant TRUNCATE on table public."content_file_revisions" to "service_role";

grant UPDATE on table public."content_file_revisions" to "service_role";

grant SELECT on sequence public."content_file_revisions_id_seq" to "service_role";

grant USAGE on sequence public."content_file_revisions_id_seq" to "service_role";

grant SELECT on table public."content_files" to "authenticated";

grant DELETE on table public."content_files" to "service_role";

grant INSERT on table public."content_files" to "service_role";

grant MAINTAIN on table public."content_files" to "service_role";

grant REFERENCES on table public."content_files" to "service_role";

grant SELECT on table public."content_files" to "service_role";

grant TRIGGER on table public."content_files" to "service_role";

grant TRUNCATE on table public."content_files" to "service_role";

grant UPDATE on table public."content_files" to "service_role";

grant SELECT on sequence public."content_files_id_seq" to "service_role";

grant USAGE on sequence public."content_files_id_seq" to "service_role";

grant SELECT on table public."conversation_messages" to "anon";

grant INSERT on table public."conversation_messages" to "authenticated";

grant SELECT on table public."conversation_messages" to "authenticated";

grant DELETE on table public."conversation_messages" to "service_role";

grant INSERT on table public."conversation_messages" to "service_role";

grant MAINTAIN on table public."conversation_messages" to "service_role";

grant REFERENCES on table public."conversation_messages" to "service_role";

grant SELECT on table public."conversation_messages" to "service_role";

grant TRIGGER on table public."conversation_messages" to "service_role";

grant TRUNCATE on table public."conversation_messages" to "service_role";

grant UPDATE on table public."conversation_messages" to "service_role";

grant SELECT on sequence public."conversation_messages_id_seq" to "authenticated";

grant USAGE on sequence public."conversation_messages_id_seq" to "authenticated";

grant SELECT on sequence public."conversation_messages_id_seq" to "service_role";

grant USAGE on sequence public."conversation_messages_id_seq" to "service_role";

grant SELECT on table public."conversations" to "anon";

grant INSERT on table public."conversations" to "authenticated";

grant SELECT on table public."conversations" to "authenticated";

grant DELETE on table public."conversations" to "service_role";

grant INSERT on table public."conversations" to "service_role";

grant MAINTAIN on table public."conversations" to "service_role";

grant REFERENCES on table public."conversations" to "service_role";

grant SELECT on table public."conversations" to "service_role";

grant TRIGGER on table public."conversations" to "service_role";

grant TRUNCATE on table public."conversations" to "service_role";

grant UPDATE on table public."conversations" to "service_role";

grant SELECT on sequence public."conversations_id_seq" to "authenticated";

grant USAGE on sequence public."conversations_id_seq" to "authenticated";

grant SELECT on sequence public."conversations_id_seq" to "service_role";

grant USAGE on sequence public."conversations_id_seq" to "service_role";

grant SELECT on table public."custom_pages" to "anon";

grant DELETE on table public."custom_pages" to "authenticated";

grant INSERT on table public."custom_pages" to "authenticated";

grant SELECT on table public."custom_pages" to "authenticated";

grant UPDATE on table public."custom_pages" to "authenticated";

grant DELETE on table public."custom_pages" to "service_role";

grant INSERT on table public."custom_pages" to "service_role";

grant MAINTAIN on table public."custom_pages" to "service_role";

grant REFERENCES on table public."custom_pages" to "service_role";

grant SELECT on table public."custom_pages" to "service_role";

grant TRIGGER on table public."custom_pages" to "service_role";

grant TRUNCATE on table public."custom_pages" to "service_role";

grant UPDATE on table public."custom_pages" to "service_role";

grant SELECT on table public."email_sends" to "authenticated";

grant DELETE on table public."email_sends" to "service_role";

grant INSERT on table public."email_sends" to "service_role";

grant MAINTAIN on table public."email_sends" to "service_role";

grant REFERENCES on table public."email_sends" to "service_role";

grant SELECT on table public."email_sends" to "service_role";

grant TRIGGER on table public."email_sends" to "service_role";

grant TRUNCATE on table public."email_sends" to "service_role";

grant UPDATE on table public."email_sends" to "service_role";

grant SELECT on sequence public."email_sends_id_seq" to "service_role";

grant USAGE on sequence public."email_sends_id_seq" to "service_role";

grant SELECT on table public."entitlements" to "anon";

grant INSERT on table public."entitlements" to "authenticated";

grant SELECT on table public."entitlements" to "authenticated";

grant DELETE on table public."entitlements" to "service_role";

grant INSERT on table public."entitlements" to "service_role";

grant MAINTAIN on table public."entitlements" to "service_role";

grant REFERENCES on table public."entitlements" to "service_role";

grant SELECT on table public."entitlements" to "service_role";

grant TRIGGER on table public."entitlements" to "service_role";

grant TRUNCATE on table public."entitlements" to "service_role";

grant UPDATE on table public."entitlements" to "service_role";

grant SELECT on sequence public."entitlements_id_seq" to "service_role";

grant USAGE on sequence public."entitlements_id_seq" to "service_role";

grant SELECT on table public."evaluations" to "anon";

grant SELECT on table public."evaluations" to "authenticated";

grant DELETE on table public."evaluations" to "service_role";

grant INSERT on table public."evaluations" to "service_role";

grant MAINTAIN on table public."evaluations" to "service_role";

grant REFERENCES on table public."evaluations" to "service_role";

grant SELECT on table public."evaluations" to "service_role";

grant TRIGGER on table public."evaluations" to "service_role";

grant TRUNCATE on table public."evaluations" to "service_role";

grant UPDATE on table public."evaluations" to "service_role";

grant SELECT on sequence public."evaluations_id_seq" to "service_role";

grant USAGE on sequence public."evaluations_id_seq" to "service_role";

grant SELECT on table public."event_details" to "anon";

grant DELETE on table public."event_details" to "authenticated";

grant INSERT on table public."event_details" to "authenticated";

grant SELECT on table public."event_details" to "authenticated";

grant UPDATE on table public."event_details" to "authenticated";

grant DELETE on table public."event_details" to "service_role";

grant INSERT on table public."event_details" to "service_role";

grant MAINTAIN on table public."event_details" to "service_role";

grant REFERENCES on table public."event_details" to "service_role";

grant SELECT on table public."event_details" to "service_role";

grant TRIGGER on table public."event_details" to "service_role";

grant TRUNCATE on table public."event_details" to "service_role";

grant UPDATE on table public."event_details" to "service_role";

grant SELECT on table public."inbox_items" to "authenticated";

grant UPDATE on table public."inbox_items" to "authenticated";

grant DELETE on table public."inbox_items" to "service_role";

grant INSERT on table public."inbox_items" to "service_role";

grant MAINTAIN on table public."inbox_items" to "service_role";

grant REFERENCES on table public."inbox_items" to "service_role";

grant SELECT on table public."inbox_items" to "service_role";

grant TRIGGER on table public."inbox_items" to "service_role";

grant TRUNCATE on table public."inbox_items" to "service_role";

grant UPDATE on table public."inbox_items" to "service_role";

grant SELECT on sequence public."inbox_items_id_seq" to "service_role";

grant USAGE on sequence public."inbox_items_id_seq" to "service_role";

grant SELECT on table public."milestones" to "authenticated";

grant DELETE on table public."milestones" to "service_role";

grant INSERT on table public."milestones" to "service_role";

grant MAINTAIN on table public."milestones" to "service_role";

grant REFERENCES on table public."milestones" to "service_role";

grant SELECT on table public."milestones" to "service_role";

grant TRIGGER on table public."milestones" to "service_role";

grant TRUNCATE on table public."milestones" to "service_role";

grant UPDATE on table public."milestones" to "service_role";

grant SELECT on sequence public."milestones_id_seq" to "service_role";

grant USAGE on sequence public."milestones_id_seq" to "service_role";

grant SELECT on table public."orders" to "authenticated";

grant DELETE on table public."orders" to "service_role";

grant INSERT on table public."orders" to "service_role";

grant MAINTAIN on table public."orders" to "service_role";

grant REFERENCES on table public."orders" to "service_role";

grant SELECT on table public."orders" to "service_role";

grant TRIGGER on table public."orders" to "service_role";

grant TRUNCATE on table public."orders" to "service_role";

grant UPDATE on table public."orders" to "service_role";

grant SELECT on sequence public."orders_id_seq" to "service_role";

grant USAGE on sequence public."orders_id_seq" to "service_role";

grant SELECT on table public."payment_events" to "authenticated";

grant DELETE on table public."payment_events" to "service_role";

grant INSERT on table public."payment_events" to "service_role";

grant MAINTAIN on table public."payment_events" to "service_role";

grant REFERENCES on table public."payment_events" to "service_role";

grant SELECT on table public."payment_events" to "service_role";

grant TRIGGER on table public."payment_events" to "service_role";

grant TRUNCATE on table public."payment_events" to "service_role";

grant UPDATE on table public."payment_events" to "service_role";

grant SELECT on sequence public."payment_events_id_seq" to "service_role";

grant USAGE on sequence public."payment_events_id_seq" to "service_role";

grant SELECT on table public."profiles" to "authenticated";

grant DELETE on table public."profiles" to "service_role";

grant INSERT on table public."profiles" to "service_role";

grant MAINTAIN on table public."profiles" to "service_role";

grant REFERENCES on table public."profiles" to "service_role";

grant SELECT on table public."profiles" to "service_role";

grant TRIGGER on table public."profiles" to "service_role";

grant TRUNCATE on table public."profiles" to "service_role";

grant UPDATE on table public."profiles" to "service_role";

grant SELECT on table public."publish_requests" to "authenticated";

grant DELETE on table public."publish_requests" to "service_role";

grant INSERT on table public."publish_requests" to "service_role";

grant MAINTAIN on table public."publish_requests" to "service_role";

grant REFERENCES on table public."publish_requests" to "service_role";

grant SELECT on table public."publish_requests" to "service_role";

grant TRIGGER on table public."publish_requests" to "service_role";

grant TRUNCATE on table public."publish_requests" to "service_role";

grant UPDATE on table public."publish_requests" to "service_role";

grant SELECT on table public."registrations" to "authenticated";

grant UPDATE on table public."registrations" to "authenticated";

grant DELETE on table public."registrations" to "service_role";

grant INSERT on table public."registrations" to "service_role";

grant MAINTAIN on table public."registrations" to "service_role";

grant REFERENCES on table public."registrations" to "service_role";

grant SELECT on table public."registrations" to "service_role";

grant TRIGGER on table public."registrations" to "service_role";

grant TRUNCATE on table public."registrations" to "service_role";

grant UPDATE on table public."registrations" to "service_role";

grant SELECT on sequence public."registrations_id_seq" to "service_role";

grant USAGE on sequence public."registrations_id_seq" to "service_role";

grant SELECT on table public."series" to "anon";

grant INSERT on table public."series" to "authenticated";

grant SELECT on table public."series" to "authenticated";

grant UPDATE on table public."series" to "authenticated";

grant DELETE on table public."series" to "service_role";

grant INSERT on table public."series" to "service_role";

grant MAINTAIN on table public."series" to "service_role";

grant REFERENCES on table public."series" to "service_role";

grant SELECT on table public."series" to "service_role";

grant TRIGGER on table public."series" to "service_role";

grant TRUNCATE on table public."series" to "service_role";

grant UPDATE on table public."series" to "service_role";

grant SELECT on sequence public."series_id_seq" to "authenticated";

grant USAGE on sequence public."series_id_seq" to "authenticated";

grant SELECT on sequence public."series_id_seq" to "service_role";

grant USAGE on sequence public."series_id_seq" to "service_role";

grant SELECT on table public."services" to "anon";

grant DELETE on table public."services" to "authenticated";

grant INSERT on table public."services" to "authenticated";

grant SELECT on table public."services" to "authenticated";

grant UPDATE on table public."services" to "authenticated";

grant DELETE on table public."services" to "service_role";

grant INSERT on table public."services" to "service_role";

grant MAINTAIN on table public."services" to "service_role";

grant REFERENCES on table public."services" to "service_role";

grant SELECT on table public."services" to "service_role";

grant TRIGGER on table public."services" to "service_role";

grant TRUNCATE on table public."services" to "service_role";

grant UPDATE on table public."services" to "service_role";

grant SELECT on sequence public."services_id_seq" to "authenticated";

grant USAGE on sequence public."services_id_seq" to "authenticated";

grant SELECT on sequence public."services_id_seq" to "service_role";

grant USAGE on sequence public."services_id_seq" to "service_role";

grant SELECT on table public."site_config" to "anon";

grant SELECT on table public."site_config" to "authenticated";

grant UPDATE on table public."site_config" to "authenticated";

grant DELETE on table public."site_config" to "service_role";

grant INSERT on table public."site_config" to "service_role";

grant MAINTAIN on table public."site_config" to "service_role";

grant REFERENCES on table public."site_config" to "service_role";

grant SELECT on table public."site_config" to "service_role";

grant TRIGGER on table public."site_config" to "service_role";

grant TRUNCATE on table public."site_config" to "service_role";

grant UPDATE on table public."site_config" to "service_role";

grant DELETE on table public."site_secrets" to "authenticated";

grant INSERT on table public."site_secrets" to "authenticated";

grant SELECT on table public."site_secrets" to "authenticated";

grant UPDATE on table public."site_secrets" to "authenticated";

grant DELETE on table public."site_secrets" to "service_role";

grant INSERT on table public."site_secrets" to "service_role";

grant MAINTAIN on table public."site_secrets" to "service_role";

grant REFERENCES on table public."site_secrets" to "service_role";

grant SELECT on table public."site_secrets" to "service_role";

grant TRIGGER on table public."site_secrets" to "service_role";

grant TRUNCATE on table public."site_secrets" to "service_role";

grant UPDATE on table public."site_secrets" to "service_role";

grant SELECT on table public."skill_details" to "anon";

grant SELECT on table public."skill_details" to "authenticated";

grant DELETE on table public."skill_details" to "service_role";

grant INSERT on table public."skill_details" to "service_role";

grant MAINTAIN on table public."skill_details" to "service_role";

grant REFERENCES on table public."skill_details" to "service_role";

grant SELECT on table public."skill_details" to "service_role";

grant TRIGGER on table public."skill_details" to "service_role";

grant TRUNCATE on table public."skill_details" to "service_role";

grant UPDATE on table public."skill_details" to "service_role";

grant UPDATE ("status") on table public."conversations" to "authenticated";

-- Neutral singleton configuration. No owner, content, credentials or sale price.
-- Existing site configuration is preserved; this file is not an upgrade migration.
insert into public.site_config (
  id, site_name, tagline, owner_name, footer_credit,
  identity, constraints, contact, commerce, avatar_config, home_config
) values (
  1, '我的站点', null, '站主（待配置）', true,
  '{"one_liner":"站点初始化完成，请站主配置名片","languages":["zh-CN"],"timezone":"UTC","focus_areas":[],"show_subscription_card":false}'::jsonb,
  '{"working_hours":"待站主配置","response_time":"待站主配置","current_load":"待站主配置","exclusions":[]}'::jsonb,
  '{"booking_page":""}'::jsonb,
  '{"payment_enabled":false,"payment_channels":[],"subscription_price":null,"refund_policy_page":"","subscribe_page":""}'::jsonb,
  '{"enabled":false,"anonymous_entry":false}'::jsonb,
  '{"hero":{"ask_placeholder":"想了解什么？","enabled":true,"tone":"light"},"fact_badges":[],"blocks":[{"type":"blog","enabled":true,"title":"博客","limit":6},{"type":"handbook","enabled":true,"title":"手册","limit":6},{"type":"skill","enabled":true,"title":"技能","limit":6},{"type":"event","enabled":true,"title":"活动","limit":6},{"type":"service","enabled":true,"title":"服务","limit":6}]}'::jsonb
) on conflict (id) do nothing;


insert into public.app_schema_version(id,version) values(1,'20260928124423');


-- Source migration: 20260928155549_security_review_payment_and_visibility.sql
-- Append-only release repair. No historical orders, events, conversations or content are rewritten.

do $$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20260928124423') then
    raise exception 'Unexpected application version; apply migrations in order';
  end if;
end $$;

-- Parent lifecycle applies to metadata and, through their article lookup, body/chunk RLS.
drop policy articles_read on public.articles;
create policy articles_read on public.articles for select to anon, authenticated
using (
  (select public.is_owner()) or (
    status in ('published','paused') and (
      (type='blog' and series_id is null) or
      (type='chapter' and exists (
        select 1 from public.series s where s.id=articles.series_id and s.status in ('published','paused')
      ))
    )
  )
);

-- The authenticated owner can edit tables directly through REST; retention must survive that path.
-- Trusted service/database maintenance roles retain repair/import authority.
create function public.guard_content_lifecycle() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('anon','authenticated') then return new; end if;
  if old.status='archived' then raise exception 'ARCHIVED_CONTENT_IMMUTABLE'; end if;
  if new.status=old.status then
    if new.paused_at is distinct from old.paused_at then raise exception 'RETENTION_CLOCK_IMMUTABLE'; end if;
    return new;
  end if;
  if not ((old.status='draft' and new.status='published') or (old.status='published' and new.status='paused')
    or (old.status='paused' and new.status in ('published','archived'))) then raise exception 'INVALID_CONTENT_TRANSITION'; end if;
  if new.status='archived' then
    if old.paused_at is null or old.paused_at>now()-interval '3 months' then raise exception 'RETENTION_PERIOD'; end if;
    new.paused_at := old.paused_at;
  elsif new.status='paused' then
    new.paused_at := now();
  elsif new.status='published' then
    new.paused_at := null;
  end if;
  return new;
end $$;
revoke all on function public.guard_content_lifecycle() from public,anon,authenticated,service_role;
create trigger guard_content_lifecycle before update on public.articles for each row execute function public.guard_content_lifecycle();
create trigger guard_content_lifecycle before update on public.series for each row execute function public.guard_content_lifecycle();

-- The ask API owns conversation writes. Browser INSERT was unused and allowed post-review appends.
revoke insert on public.conversations, public.conversation_messages from anon, authenticated;
revoke usage, select on sequence public.conversations_id_seq, public.conversation_messages_id_seq from anon, authenticated;
drop policy conversations_own_insert on public.conversations;
drop policy conversation_messages_own_insert on public.conversation_messages;

-- Raw transcripts remain private even after moderation; public QA is an explicit editorial artifact.
alter policy conversations_own_read on public.conversations using (user_id=(select auth.uid()) or (select public.is_owner()));
alter policy conversation_messages_read on public.conversation_messages using (
  exists(select 1 from public.conversations c where c.id=conversation_id and (c.user_id=(select auth.uid()) or (select public.is_owner())))
);
create table public.conversation_publications (
  conversation_id bigint primary key references public.conversations(id) on delete cascade,
  article_id bigint references public.articles(id) on delete set null,
  question_md text not null check (length(btrim(question_md)) between 1 and 2000),
  answer_md text not null check (length(btrim(answer_md)) between 1 and 12000),
  updated_at timestamptz not null default now()
);
create index conversation_publications_article_idx on public.conversation_publications(article_id);
alter table public.conversation_publications enable row level security;
create policy publications_public_read on public.conversation_publications for select to anon, authenticated
using (article_id is null or exists(select 1 from public.articles a where a.id=article_id));
create policy publications_owner_all on public.conversation_publications for all to authenticated
using ((select public.is_owner())) with check ((select public.is_owner()));
-- Explicit grants override permissive hosted defaults for this newly introduced table.
revoke all on public.conversation_publications from public, anon, authenticated;
grant select on public.conversation_publications to anon, authenticated;
grant insert, update, delete on public.conversation_publications to authenticated;
grant all on public.conversation_publications to service_role;

create function public.review_conversation(p_id bigint, p_status text, p_question text, p_answer text, p_confirmed boolean)
returns void language plpgsql set search_path='' as $$
declare v_article bigint;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
  if p_status not in ('public','hidden') or p_status is null then raise exception 'INVALID_REVIEW'; end if;
  select article_id into v_article from public.conversations where id=p_id for update;
  if not found then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_status='public' then
    if p_confirmed is distinct from true then raise exception 'PUBLIC_COPY_CONFIRMATION_REQUIRED'; end if;
    insert into public.conversation_publications(conversation_id,article_id,question_md,answer_md)
    values(p_id,v_article,btrim(p_question),btrim(p_answer))
    on conflict(conversation_id) do update set question_md=excluded.question_md,answer_md=excluded.answer_md,updated_at=now();
  else
    delete from public.conversation_publications where conversation_id=p_id;
  end if;
  update public.conversations set status=p_status where id=p_id;
end $$;
revoke all on function public.review_conversation(bigint,text,text,text,boolean) from public, anon;
grant execute on function public.review_conversation(bigint,text,text,text,boolean) to authenticated;

-- Legacy query events used return:/reconcile: aliases; index their recorded provider trade number.
create index payment_events_trade_no_idx on public.payment_events(provider, (payload->>'trade_no'));

create or replace function public.settle_payment(p_order_id bigint, p_event_id text, p_amount numeric, p_payload jsonb)
returns text language plpgsql set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_event public.payment_events%rowtype;
  v_trade text;
  v_bound text;
  v_duplicate boolean := false;
begin
  if p_event_id is null or btrim(p_event_id)='' or length(p_event_id)>256 then raise exception 'EMPTY_EVENT'; end if;
  if p_payload is not null and jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD'; end if;
  -- Accept the old server's query event format during a rolling deployment, but store one canonical key.
  v_trade := coalesce(nullif(p_payload->>'trade_no',''), p_event_id);
  if length(v_trade)>256 then raise exception 'EMPTY_EVENT'; end if;
  -- Same provider transaction, even across different orders, is serialized before inspecting the inbox.
  perform pg_advisory_xact_lock(hashtextextended('zpay-event:' || v_trade, 0));
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.provider<>'zpay' then raise exception 'PROVIDER_MISMATCH'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>v_order.amount then raise exception 'AMOUNT_MISMATCH'; end if;
  -- Only pending can open rights. Fulfilled/refunded/failed never re-enter settlement.
  if v_order.status not in ('pending','paid') then raise exception 'ORDER_NOT_PENDING'; end if;

  for v_event in select * from public.payment_events
    where provider='zpay' and (event_id=v_trade or payload->>'trade_no'=v_trade)
  loop
    v_bound := coalesce(
      v_event.payload->>'settlement_order_id',
      v_event.payload->>'out_trade_no',
      substring(v_event.event_id from '^(?:return|reconcile):([0-9]+):')
    );
    -- Unknown legacy bindings require operator reconciliation; do not guess or grant.
    if v_bound is null then raise exception 'EVENT_BINDING_REQUIRED'; end if;
    if v_bound<>p_order_id::text then raise exception 'EVENT_ORDER_MISMATCH'; end if;
    v_duplicate := true;
  end loop;
  if v_duplicate then
    if v_order.status<>'paid' then raise exception 'EVENT_BINDING_REQUIRED'; end if;
    return 'duplicate';
  end if;

  insert into public.payment_events(provider,event_id,payload)
  values('zpay',v_trade,coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('settlement_order_id',p_order_id::text,'trade_no',v_trade));
  if v_order.status='paid' then return 'already_paid'; end if;

  -- Different pending orders for one entitlement must also serialize their active-right check.
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || v_order.user_id::text || ':' || v_order.sku_type || ':' || coalesce(v_order.target_id::text,''), 0));
  update public.orders set status='paid' where id=p_order_id;
  insert into public.entitlements(user_id,type,target_id,ends_at,source,source_ref)
  select v_order.user_id,v_order.sku_type,v_order.target_id,
    case when v_order.sku_type='subscription' then now()+interval '1 year' else null end,
    'order','order:' || v_order.id
  where not exists (
    select 1 from public.entitlements e where e.user_id=v_order.user_id and e.type=v_order.sku_type
      and e.target_id is not distinct from v_order.target_id
      and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
  );
  return 'settled';
end $$;
revoke all on function public.settle_payment(bigint,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.settle_payment(bigint,text,numeric,jsonb) to service_role;

create function public.create_pending_order(p_user_id uuid,p_sku text,p_target bigint,p_amount numeric)
returns jsonb language plpgsql set search_path='' as $$
declare v_price numeric; v_order public.orders%rowtype;
begin
  -- Revalidate the server price snapshot while holding a shared product/configuration lock.
  if p_sku='subscription' and p_target is null then
    select (commerce->'subscription_price'->>'amount')::numeric into v_price from public.site_config where id=1 for share;
  elsif p_sku='series' then
    select price into v_price from public.series where id=p_target and type in ('handbook','skill') and status='published' for share;
  elsif p_sku='single' then
    select price into v_price from public.articles where id=p_target and type='blog' and series_id is null and access='paid' and status='published' for share;
  elsif p_sku='event' then
    select d.ticket_price into v_price from public.event_details d join public.series s on s.id=d.series_id
      where s.id=p_target and s.type='event' and s.status='published' and d.state in ('upcoming','registering') for share of s,d;
  end if;
  if v_price is null or v_price<=0 or p_amount is null or p_amount<>v_price then raise exception 'NOT_SELLABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || p_user_id::text || ':' || p_sku || ':' || coalesce(p_target::text,''),0));
  if exists(select 1 from public.entitlements e where e.user_id=p_user_id and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
    and (e.type='subscription' or (e.type=p_sku and e.target_id is not distinct from p_target))) then raise exception 'ALREADY_ENTITLED'; end if;
  select * into v_order from public.orders where user_id=p_user_id and sku_type=p_sku
    and target_id is not distinct from p_target and amount=v_price and status='pending' and provider='zpay'
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_order); end if;
  insert into public.orders(user_id,sku_type,target_id,amount) values(p_user_id,p_sku,p_target,v_price) returning * into v_order;
  return to_jsonb(v_order);
end $$;
revoke all on function public.create_pending_order(uuid,text,bigint,numeric) from public,anon,authenticated;
grant execute on function public.create_pending_order(uuid,text,bigint,numeric) to service_role;

update public.app_schema_version set version='20260928155549' where id=1;

-- Source migration: 20260929134545_payment_mail_outbox.sql
-- Additive upgrade. Existing settle_payment remains compatible with old applications.
-- Only the queued entry point captures newly granted rights; historical payments are not backfilled.

do $guard$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20260928155549') then
    raise exception 'MAIL_UPGRADE_REQUIRES_20260928155549';
  end if;
end $guard$;

create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'grant' check (kind='grant'),
  order_id bigint not null references public.orders(id) on delete cascade,
  entitlement_id bigint not null unique references public.entitlements(id) on delete cascade,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  status text not null default 'pending' check (status in ('pending','processing','retry','sent','dead')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  message jsonb,
  provider_fingerprint text,
  started_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(kind,order_id),
  check ((status='processing' and lease_token is not null and lease_until is not null)
      or (status<>'processing' and lease_token is null and lease_until is null)),
  check ((message is null and provider_fingerprint is null and started_at is null)
      or (message is not null and jsonb_typeof(message)='object' and provider_fingerprint is not null and started_at is not null)),
  check (status<>'sent' or provider_message_id is not null)
);
create index email_outbox_due on public.email_outbox(next_attempt_at,created_at)
  where status in ('pending','retry');
create index email_outbox_lease on public.email_outbox(lease_until)
  where status='processing';
alter table public.email_outbox enable row level security;
create policy email_outbox_service on public.email_outbox for all to service_role using (true) with check (true);
revoke all on public.email_outbox from public,anon,authenticated,service_role;
grant select,insert,update on public.email_outbox to service_role;

create function public.queue_grant_email() returns trigger language plpgsql set search_path='' as $$
declare v_order public.orders%rowtype; v_title text; v_site text;
begin
  if current_setting('youai.queue_mail',true) is distinct from 'on' or new.source<>'order' then return new; end if;
  select * into v_order from public.orders where 'order:'||id::text=new.source_ref
    and status='paid' and user_id=new.user_id and sku_type=new.type and target_id is not distinct from new.target_id;
  if not found then raise exception 'MAIL_ORDER_BINDING_REQUIRED'; end if;
  if v_order.sku_type='subscription' then v_title:='全站订阅（1 年）';
  elsif v_order.sku_type='single' then select title into v_title from public.articles where id=v_order.target_id;
  else select title into v_title from public.series where id=v_order.target_id;
  end if;
  select site_name into v_site from public.site_config where id=1;
  insert into public.email_outbox(order_id,entitlement_id,snapshot)
  values(v_order.id,new.id,jsonb_build_object('version',1,'user_id',new.user_id,'order_id',v_order.id,
    'site_name',coalesce(v_site,'站点'),'description',coalesce(v_title,'已购内容'),'ends_at',new.ends_at));
  return new;
end $$;
revoke all on function public.queue_grant_email() from public,anon,authenticated,service_role;
create trigger queue_grant_email after insert on public.entitlements for each row execute function public.queue_grant_email();

create function public.settle_payment_queued(p_order_id bigint,p_event_id text,p_amount numeric,p_payload jsonb)
returns text language plpgsql set search_path='' as $$
declare v_result text; v_previous text:=current_setting('youai.queue_mail',true);
begin
  perform set_config('youai.queue_mail','on',true);
  v_result:=public.settle_payment(p_order_id,p_event_id,p_amount,p_payload);
  perform set_config('youai.queue_mail',coalesce(v_previous,''),true);
  return v_result;
end $$;

create function public.claim_email_job() returns jsonb language plpgsql set search_path='' as $$
declare v_job public.email_outbox%rowtype;
begin
  -- Never race a current lease; abandoned jobs remain recoverable with a new fencing token.
  with expired as (
    select id from public.email_outbox where
      (status in ('pending','retry') or (status='processing' and lease_until<=clock_timestamp()))
      and (attempts>=8 or started_at<=clock_timestamp()-interval '23 hours')
    for update skip locked
  )
  update public.email_outbox o set status='dead',lease_token=null,lease_until=null,updated_at=clock_timestamp(),
    last_error=case when o.started_at<=clock_timestamp()-interval '23 hours' then 'window_expired' else 'attempts_exhausted' end
    from expired e where o.id=e.id;
  select * into v_job from public.email_outbox where attempts<8
    and (started_at is null or started_at>clock_timestamp()-interval '23 hours')
    and ((status in ('pending','retry') and next_attempt_at<=clock_timestamp())
      or (status='processing' and lease_until<=clock_timestamp()))
    order by next_attempt_at,created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  update public.email_outbox set status='processing',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
    where id=v_job.id returning * into v_job;
  return to_jsonb(v_job);
end $$;

create function public.prepare_email_job(p_id uuid,p_token uuid,p_message jsonb,p_fingerprint text)
returns jsonb language plpgsql set search_path='' as $$
declare v_job public.email_outbox%rowtype;
begin
  select * into v_job from public.email_outbox where id=p_id and status='processing'
    and lease_token=p_token and lease_until>clock_timestamp() for update;
  if not found then raise exception 'MAIL_LEASE_LOST'; end if;
  if v_job.message is null then
    if p_message is null or jsonb_typeof(p_message)<>'object' or octet_length(p_message::text)>131072
      or exists(select 1 from unnest(array['from','to','subject','html','text']) k
        where jsonb_typeof(p_message->k) is distinct from 'string' or length(btrim(p_message->>k))=0)
      or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'MAIL_INVALID_MESSAGE'; end if;
    update public.email_outbox set message=p_message,provider_fingerprint=p_fingerprint,started_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=p_id returning * into v_job;
  end if;
  return to_jsonb(v_job);
end $$;

create function public.finish_email_job(p_id uuid,p_token uuid,p_outcome text,p_code text,p_provider_id text)
returns boolean language plpgsql set search_path='' as $$
declare v_job public.email_outbox%rowtype; v_status text; v_code text;
begin
  select * into v_job from public.email_outbox where id=p_id and status='processing'
    and lease_token=p_token and lease_until>clock_timestamp() for update;
  if not found then return false; end if;
  if p_outcome not in ('sent','retry','dead') or p_outcome is null then raise exception 'MAIL_INVALID_OUTCOME'; end if;
  if p_outcome='sent' and (v_job.message is null or p_provider_id is null or length(btrim(p_provider_id))=0 or length(p_provider_id)>256) then
    raise exception 'MAIL_RECEIPT_REQUIRED';
  end if;
  if p_outcome<>'sent' and (p_code is null or p_code not in ('network','provider_retry','provider_rejected','invalid_response',
    'config_changed','recipient_missing','preparation_failed','window_expired','attempts_exhausted')) then raise exception 'MAIL_INVALID_ERROR_CODE'; end if;
  v_status:=p_outcome; v_code:=case when p_outcome='sent' then null else p_code end;
  if p_outcome='retry' and (v_job.attempts>=8 or v_job.started_at<=clock_timestamp()-interval '23 hours') then
    v_status:='dead'; v_code:=case when v_job.attempts>=8 then 'attempts_exhausted' else 'window_expired' end;
  end if;
  update public.email_outbox set status=v_status,last_error=v_code,
    provider_message_id=case when p_outcome='sent' then p_provider_id else provider_message_id end,
    lease_token=null,lease_until=null,updated_at=clock_timestamp(),
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,attempts-1))::integer)
    where id=p_id;
  return true;
end $$;

create function public.email_outbox_health() returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('pending',count(*) filter(where status in ('pending','retry')),
    'processing',count(*) filter(where status='processing'),'sent',count(*) filter(where status='sent'),
    'dead',count(*) filter(where status='dead'),
    'oldest_due_seconds',coalesce(extract(epoch from now()-min(case
      when status in ('pending','retry') and next_attempt_at<=now() then next_attempt_at
      when status='processing' and lease_until<=now() then lease_until end)),0)) from public.email_outbox
$$;

revoke all on function public.settle_payment_queued(bigint,text,numeric,jsonb),public.claim_email_job(),
  public.prepare_email_job(uuid,uuid,jsonb,text),public.finish_email_job(uuid,uuid,text,text,text),public.email_outbox_health()
  from public,anon,authenticated;
grant execute on function public.settle_payment_queued(bigint,text,numeric,jsonb),public.claim_email_job(),
  public.prepare_email_job(uuid,uuid,jsonb,text),public.finish_email_job(uuid,uuid,text,text,text),public.email_outbox_health() to service_role;

update public.app_schema_version set version='20260929134545',applied_at=now() where id=1;

-- Source migration: 20261008111841_consistent_site_export.sql
-- Additive, read-only export API. No application rows or RLS policies are changed.

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

-- Source migration: 20261010053221_avatar_quota_reservations.sql

do $guard$ begin
  if (select version from public.app_schema_version where id=1) is distinct from '20261008111841' then
    raise exception 'Expected application schema 20261008111841';
  end if;
end $guard$;

-- Existing usage is retained as succeeded; new attempts reserve before any generation call.
alter table public.avatar_usage
  add column request_id uuid,
  add column generation_state text not null default 'succeeded',
  add column reservation_expires_at timestamptz,
  add constraint avatar_usage_request_unique unique (request_id),
  add constraint avatar_usage_generation_state check (generation_state in ('reserved','dispatched','succeeded','unknown','released')),
  add constraint avatar_usage_reservation_shape check (
    (request_id is null and generation_state='succeeded' and reservation_expires_at is null)
    or (request_id is not null and reservation_expires_at is not null));
create index idx_avatar_usage_ip_day on public.avatar_usage(ip,created_at) where user_id is null;

create function public.reserve_avatar_generation(p_request_id uuid,p_user_id uuid,p_ip text,p_model text)
returns text language plpgsql security invoker set search_path='' as $fn$
declare
  v_now timestamptz; v_day timestamptz; v_month timestamptz; v_config jsonb;
  v_owner boolean := false; v_cap integer; v_month_cap numeric; v_existing public.avatar_usage;
begin
  if p_request_id is null or nullif(btrim(p_model),'') is null or length(p_model)>200
    or length(coalesce(p_ip,''))>128 or (p_user_id is null and nullif(btrim(p_ip),'') is null) then
    raise exception 'INVALID_GENERATION_REQUEST';
  end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'QUOTA_REQUIRES_READ_COMMITTED'; end if;
  -- One short transaction lock per OPC: count + insert must be atomic across workers.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('avatar-quota',0));
  v_now := clock_timestamp();
  v_day := date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  v_month := date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC';
  select * into v_existing from public.avatar_usage where request_id=p_request_id;
  if found then
    if v_existing.user_id is distinct from p_user_id or v_existing.ip is distinct from p_ip or v_existing.model<>p_model then
      raise exception 'GENERATION_REQUEST_MISMATCH';
    end if;
    return 'duplicate'; -- Never authorizes a second outbound request.
  end if;
  select avatar_config into v_config from public.site_config where id=1;
  if coalesce(v_config->>'enabled','false')<>'true' then return 'disabled'; end if;
  if p_user_id is null then
    if coalesce(v_config->>'anonymous_entry','false')<>'true' then return 'disabled'; end if;
    v_cap := 5;
  else
    select is_owner into v_owner from public.profiles where id=p_user_id;
    if not found then raise exception 'INVALID_GENERATION_PRINCIPAL'; end if;
    v_cap := case when exists(select 1 from public.entitlements where user_id=p_user_id and type='subscription'
      and revoked_at is null and starts_at<=v_now and (ends_at is null or ends_at>v_now)) then 100 else 20 end;
  end if;
  if v_config->'monthly_limit' is not null and v_config->'monthly_limit'<>'null'::jsonb then
    if jsonb_typeof(v_config->'monthly_limit')<>'number' then raise exception 'INVALID_GENERATION_LIMIT'; end if;
    v_month_cap := floor((v_config->>'monthly_limit')::numeric);
    if v_month_cap<0 then raise exception 'INVALID_GENERATION_LIMIT'; end if;
  end if;
  if not v_owner and (select count(*) from public.avatar_usage where created_at>=v_day
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now)
    and (case when p_user_id is not null then user_id=p_user_id else user_id is null and ip=p_ip end))>=v_cap then
    return 'daily_limit';
  end if;
  -- Owner bypasses the account daily limit, but the configured station total still applies.
  if v_month_cap is not null and (select count(*) from public.avatar_usage where created_at>=v_month
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now))>=v_month_cap then
    return 'monthly_limit';
  end if;
  insert into public.avatar_usage(user_id,ip,model,request_id,generation_state,reservation_expires_at,created_at)
    values(p_user_id,p_ip,p_model,p_request_id,'reserved',v_now+interval '60 seconds',v_now);
  return 'reserved';
end $fn$;

create function public.dispatch_avatar_generation(p_request_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare v_now timestamptz; v_updated bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('avatar-quota',0));
  v_now:=clock_timestamp();
  update public.avatar_usage set generation_state='dispatched'
    where request_id=p_request_id and generation_state='reserved' and reservation_expires_at>v_now
    and (created_at at time zone 'UTC')::date=(v_now at time zone 'UTC')::date
    and exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true')
    returning id into v_updated;
  return v_updated is not null;
end $fn$;

create function public.finish_avatar_generation(p_request_id uuid,p_outcome text,p_tokens_in integer,p_tokens_out integer)
returns boolean language plpgsql security invoker set search_path='' as $fn$
declare v_updated bigint;
begin
  if p_outcome is null or p_outcome not in ('succeeded','unknown','released') or p_tokens_in is null or p_tokens_out is null
    or p_tokens_in<0 or p_tokens_out<0 then raise exception 'INVALID_GENERATION_OUTCOME'; end if;
  update public.avatar_usage set generation_state=p_outcome,tokens_in=p_tokens_in,tokens_out=p_tokens_out
    where request_id=p_request_id and ((generation_state='reserved' and p_outcome='released')
      or (generation_state='dispatched' and p_outcome in ('succeeded','unknown')))
    returning id into v_updated;
  return v_updated is not null;
end $fn$;

revoke all on function public.reserve_avatar_generation(uuid,uuid,text,text),public.dispatch_avatar_generation(uuid),
  public.finish_avatar_generation(uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.reserve_avatar_generation(uuid,uuid,text,text),public.dispatch_avatar_generation(uuid),
  public.finish_avatar_generation(uuid,text,integer,integer) to service_role;

update public.app_schema_version set version='20261010053221',applied_at=now() where id=1;

-- Source migration: 20261011115340_payment_external_reference.sql
-- A merchant account may outlive a database or be reused by another OPC instance.
-- Existing pending orders may already have been sent to the provider under their numeric
-- local ID. Reconcile those orders before upgrading; never silently rename one.

-- Freeze order creation/settlement before checking the legacy payment queue.
-- Without this lock, an old checkout could insert a pending row after the guard.
lock table public.orders in access exclusive mode;

do $guard$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20261010053221') then
    raise exception 'PAYMENT_REFERENCE_REQUIRES_20261010053221';
  end if;
  if exists(select 1 from public.orders where status='pending') then
    raise exception 'PAYMENT_REFERENCE_PENDING_ORDERS_REQUIRE_RECONCILIATION';
  end if;
end $guard$;

-- gen_random_uuid is a cryptographic random source. Mapping its nibbles to decimal
-- yields a 32-digit provider-compatible reference with ~97 bits of entropy. The
-- leading 9 prevents leading-zero normalization by payment intermediaries.
create function public.new_merchant_order_no() returns text language sql volatile set search_path='' as $$
  select '9' || substr(translate(replace(pg_catalog.gen_random_uuid()::text,'-',''),'abcdef','012345'),1,31)
$$;
revoke all on function public.new_merchant_order_no() from public,anon,authenticated;
grant execute on function public.new_merchant_order_no() to service_role;

-- Preserve the exact number submitted to the provider by the old application.
-- Only orders created after this migration receive a random reference.
alter table public.orders add column merchant_order_no text;
update public.orders set merchant_order_no=id::text;
alter table public.orders alter column merchant_order_no set default public.new_merchant_order_no();
alter table public.orders alter column merchant_order_no set not null;
alter table public.orders add constraint orders_merchant_order_no_format
  check (merchant_order_no ~ '^9[0-9]{31}$'
    or (merchant_order_no=id::text and status<>'pending'));
alter table public.orders add constraint orders_merchant_order_no_unique unique (merchant_order_no);

-- The reference is looked up in the same transaction that opens rights. Keep the
-- existing settlement lock order (trade advisory lock, then order row lock).
-- This RPC is service-role only. Legacy numeric callbacks never resolve to a new order.
create function public.settle_payment_reference(
  p_merchant_order_no text,p_event_id text,p_amount numeric,p_payload jsonb
) returns text language plpgsql set search_path='' as $$
declare v_order_id bigint;
begin
  if p_merchant_order_no is null or p_merchant_order_no !~ '^9[0-9]{31}$'
    or p_payload is null or p_payload->>'out_trade_no' is distinct from p_merchant_order_no then
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;
  select id into v_order_id from public.orders
    where merchant_order_no=p_merchant_order_no and provider='zpay';
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  return public.settle_payment_queued(v_order_id,p_event_id,p_amount,p_payload);
end $$;
revoke all on function public.settle_payment_reference(text,text,numeric,jsonb)
  from public,anon,authenticated;
grant execute on function public.settle_payment_reference(text,text,numeric,jsonb)
  to service_role;

update public.app_schema_version set version='20261011115340' where id=1;

-- Source migration: 20261011144257_enforce_payment_reference_at_settlement.sql
-- Close the old service-only numeric RPC path as well as the new public-facing path.

set local lock_timeout='5s';

do $guard$ begin
  if not exists(select 1 from public.app_schema_version where id=1 and version='20261011115340') then
    raise exception 'PAYMENT_REFERENCE_BINDING_REQUIRES_20261011115340';
  end if;
end $guard$;

create or replace function public.settle_payment(p_order_id bigint, p_event_id text, p_amount numeric, p_payload jsonb)
returns text language plpgsql set search_path='' as $$
declare
  v_order public.orders%rowtype;
  v_event public.payment_events%rowtype;
  v_trade text;
  v_bound text;
  v_duplicate boolean := false;
begin
  if p_event_id is null or btrim(p_event_id)='' or length(p_event_id)>256 then raise exception 'EMPTY_EVENT'; end if;
  if p_payload is not null and jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_PAYLOAD'; end if;
  -- Normalize event aliases only after requiring the persisted merchant reference below.
  v_trade := coalesce(nullif(p_payload->>'trade_no',''), p_event_id);
  if length(v_trade)>256 then raise exception 'EMPTY_EVENT'; end if;
  -- Same provider transaction, even across different orders, is serialized before inspecting the inbox.
  perform pg_advisory_xact_lock(hashtextextended('zpay-event:' || v_trade, 0));
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.provider<>'zpay' then raise exception 'PROVIDER_MISMATCH'; end if;
  -- Validate under the order row lock in every entrypoint, including old RPCs.
  -- Old deployments send a local ID or no reference: both must fail closed.
  if v_order.merchant_order_no !~ '^9[0-9]{31}$'
    or p_payload is null
    or p_payload->>'out_trade_no' is distinct from v_order.merchant_order_no then
    raise exception 'PAYMENT_REFERENCE_MISMATCH';
  end if;
  if p_amount is null or p_amount<=0 or p_amount<>v_order.amount then raise exception 'AMOUNT_MISMATCH'; end if;
  -- Only pending can open rights. Fulfilled/refunded/failed never re-enter settlement.
  if v_order.status not in ('pending','paid') then raise exception 'ORDER_NOT_PENDING'; end if;

  for v_event in select * from public.payment_events
    where provider='zpay' and (event_id=v_trade or payload->>'trade_no'=v_trade)
  loop
    v_bound := coalesce(
      v_event.payload->>'settlement_order_id',
      v_event.payload->>'out_trade_no',
      substring(v_event.event_id from '^(?:return|reconcile):([0-9]+):')
    );
    -- Unknown legacy bindings require operator reconciliation; do not guess or grant.
    if v_bound is null then raise exception 'EVENT_BINDING_REQUIRED'; end if;
    if v_bound<>p_order_id::text then raise exception 'EVENT_ORDER_MISMATCH'; end if;
    v_duplicate := true;
  end loop;
  if v_duplicate then
    if v_order.status<>'paid' then raise exception 'EVENT_BINDING_REQUIRED'; end if;
    return 'duplicate';
  end if;

  insert into public.payment_events(provider,event_id,payload)
  values('zpay',v_trade,coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('settlement_order_id',p_order_id::text,'trade_no',v_trade));
  if v_order.status='paid' then return 'already_paid'; end if;

  -- Different pending orders for one entitlement must also serialize their active-right check.
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || v_order.user_id::text || ':' || v_order.sku_type || ':' || coalesce(v_order.target_id::text,''), 0));
  update public.orders set status='paid' where id=p_order_id;
  insert into public.entitlements(user_id,type,target_id,ends_at,source,source_ref)
  select v_order.user_id,v_order.sku_type,v_order.target_id,
    case when v_order.sku_type='subscription' then now()+interval '1 year' else null end,
    'order','order:' || v_order.id
  where not exists (
    select 1 from public.entitlements e where e.user_id=v_order.user_id and e.type=v_order.sku_type
      and e.target_id is not distinct from v_order.target_id
      and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
  );
  return 'settled';
end $$;
revoke all on function public.settle_payment(bigint,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.settle_payment(bigint,text,numeric,jsonb) to service_role;

update public.app_schema_version set version='20261011144257' where id=1;

-- Source migration: 20261013171232_payment_reconcile_claim.sql

set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$ begin
  if (select version from public.app_schema_version where id=1) is distinct from '20261011144257' then
    raise exception 'Expected application schema 20261011144257';
  end if;
end $guard$;

-- A claimed pending order is checked at most once per 30 minutes. This column
-- does not alter the payment state or the immutable merchant reference.
alter table public.orders add column reconcile_checked_at timestamptz;
create index idx_orders_pending_reconcile
  on public.orders (reconcile_checked_at asc nulls first, created_at, id)
  where status = 'pending';

-- The service role makes a short, atomic claim before contacting the provider.
-- SKIP LOCKED keeps concurrent cron invocations from claiming the same row.
create function public.claim_pending_payment_reconciliation()
returns table(id bigint, merchant_order_no text, user_id uuid, sku_type text,
              target_id bigint, amount numeric, status text)
language sql volatile security invoker set search_path = '' as $fn$
  with eligible as materialized (
    select o.id from public.orders o
    where o.status = 'pending'
      and o.created_at <= pg_catalog.now() - interval '10 minutes'
      and (o.reconcile_checked_at is null
           or o.reconcile_checked_at <= pg_catalog.now() - interval '30 minutes')
    order by o.reconcile_checked_at asc nulls first, o.created_at, o.id
    limit 1 for update skip locked
  )
  update public.orders o set reconcile_checked_at = pg_catalog.clock_timestamp()
    from eligible e where o.id = e.id and o.status = 'pending'
  returning o.id, o.merchant_order_no, o.user_id, o.sku_type,
            o.target_id, o.amount, o.status
$fn$;
revoke all on function public.claim_pending_payment_reconciliation()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_pending_payment_reconciliation() to service_role;

update public.app_schema_version
  set version='20261013171232', applied_at=now() where id=1;

-- Source migration: 20261015163748_collections_and_admin_queries.sql
-- Additive content capabilities and owner-only administration projections.

set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.series drop constraint series_type_check;
alter table public.series add constraint series_type_check check (type in ('collection','handbook','skill','event'));
alter table public.series add column nav_enabled boolean not null default false;
alter table public.series add column nav_label text check (length(nav_label)<=80);
alter table public.series add column nav_order integer not null default 0 check (nav_order between -10000 and 10000);
create index idx_articles_updated_id on public.articles(updated_at desc,id desc);
create index idx_series_updated_id on public.series(updated_at desc,id desc);
create index idx_bookings_status_created_id on public.bookings(status,created_at desc,id desc);
create index idx_revisions_file_version on public.content_file_revisions(file_id,version desc);

-- The latest file head and its formal publication are one logical document.
-- Only metadata is projected: no Markdown, HTML, messages or version snapshots.
create view public.admin_documents with (security_invoker=true) as
with files as (
 select f.id file_id,f.article_slug,f.scope,f.path,f.sort,
   h.id head_id,h.version head_version,h.created_at head_created_at,h.publication,
   case when h.publication is null then h.snapshot->'frontmatter'->>'title' end pending_title,
   case when h.publication is null then h.snapshot->'frontmatter'->>'access' end pending_access
 from public.content_files f
 left join lateral (select r.id,r.version,r.created_at,r.publication,r.snapshot
   from public.content_file_revisions r where r.file_id=f.id order by r.version desc limit 1) h on true
)
select coalesce('f:'||f.file_id::text,'a:'||a.id::text) document_key,
 a.id article_id,f.file_id,a.slug online_slug,coalesce(a.slug,f.article_slug) slug,
 coalesce(a.title,f.pending_title,f.article_slug) title,f.pending_title,
 concat_ws(' ',a.title,f.pending_title,f.article_slug) search_text,
 coalesce(a.type,case when f.scope='blog' then 'blog' else 'chapter' end) type,
 coalesce(a.series_id,scoped.id) series_id,s.title series_title,s.slug series_slug,s.type series_type,
 a.status,a.paused_at,coalesce(a.access,f.pending_access,'public') access,a.price,coalesce(a.featured,false) featured,
 coalesce(a.sort_order,f.sort,0) sort_order,
 coalesce(f.scope,case when a.series_id is null then 'blog' else 'series:'||s.slug end) scope,f.path,
 case when f.publication is null then f.head_id end pending_revision_id,
 case when f.publication is null then f.head_version end pending_version,
 coalesce(v.version,0) online_version,
 coalesce(greatest(a.updated_at,case when f.publication is null then f.head_created_at end),f.head_created_at) updated_at,
 (a.id is not null and s.readme_article_id=a.id) is_readme
from public.articles a full join files f on f.article_slug=a.slug
left join public.series scoped on f.scope='series:'||scoped.slug
left join public.series s on s.id=coalesce(a.series_id,scoped.id)
left join lateral (select version from public.article_versions v where v.article_id=a.id order by version desc limit 1) v on true
where (select public.is_owner());
revoke all on public.admin_documents from public,anon,authenticated,service_role;
grant select on public.admin_documents to authenticated,service_role;

create view public.admin_collections with (security_invoker=true) as
select s.*,(select count(*)::int from public.articles a where a.series_id=s.id and a.type='chapter' and a.id is distinct from s.readme_article_id) chapter_count
from public.series s where (select public.is_owner());
revoke all on public.admin_collections from public,anon,authenticated,service_role;
grant select on public.admin_collections to authenticated,service_role;

-- Each overview card is independently queried and can fail without hiding others.
create function public.admin_dashboard_card(p_section text) returns jsonb
language plpgsql stable set search_path='' as $$
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 if p_section='revenue' then return jsonb_build_object('revenueThisMonth',(select coalesce(sum(amount),0) from public.orders where status in ('paid','fulfilled') and updated_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'));
 elsif p_section='subscriptions' then return jsonb_build_object('activeSubscriptions',(select count(distinct user_id) from public.entitlements where type='subscription' and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())));
 elsif p_section='content' then return jsonb_build_object('seriesPublished',(select count(*) from public.series where status='published'),'articlesPublished',(select count(*) from public.articles where status='published'));
 elsif p_section='avatar' then return jsonb_build_object('avatarGenerationsThisMonth',(select count(*) from public.avatar_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'),'avatarGenerationsTotal',(select count(*) from public.avatar_usage),'avatarCacheHitsTotal',(select coalesce(sum(hit_count),0) from public.avatar_cache));
 else raise exception 'INVALID_METRIC'; end if;
end $$;
revoke all on function public.admin_dashboard_card(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_dashboard_card(text) to authenticated;

-- Auth email is deliberately not exposed through a public view. Only the
-- trusted server can call this definer; its application entry checks owner.
create function public.admin_user_directory(p_q text default '',p_status text default '',p_sort text default 'newest',p_offset integer default 0,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; pattern text;
begin
 if p_q is null or p_status is null or p_sort is null or p_offset is null or p_limit is null or length(p_q)>120 or p_status not in ('','subscribed','registered') or p_sort not in ('newest','oldest','active')
   or p_offset<0 or p_limit not in (20,50,100) then raise exception 'INVALID_LIST_QUERY'; end if;
 pattern := '%'||replace(replace(replace(coalesce(p_q,''),'\','\\'),'%','\%'),'_','\_')||'%';
 with directory as (
 select u.id,coalesce(u.email,'') email,u.created_at as "registeredAt",p.display_name as "displayName",
   coalesce(rights.active,false) as "subscriptionActive",rights.ends_at as "subscriptionEndsAt",
   greatest(u.created_at,rights.last_at,orders.last_at) as "lastActiveAt",coalesce(orders.count,0) as "orderCount"
 from auth.users u left join public.profiles p on p.id=u.id
 left join lateral (select bool_or(e.type='subscription' and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())) active,
   case when bool_or(e.type='subscription' and e.revoked_at is null and e.starts_at<=now() and e.ends_at is null) then null
     else max(e.ends_at) filter(where e.type='subscription' and e.revoked_at is null and e.starts_at<=now() and e.ends_at>now()) end ends_at,
   max(e.created_at) last_at from public.entitlements e where e.user_id=u.id) rights on true
 left join lateral (select count(*) count,max(o.created_at) last_at from public.orders o where o.user_id=u.id) orders on true
 where (coalesce(u.email,'') ilike pattern or coalesce(p.display_name,'') ilike pattern)
 ), filtered as (select * from directory where p_status='' or (p_status='subscribed' and "subscriptionActive") or (p_status='registered' and not "subscriptionActive")),
 page as (select * from filtered order by
   case when p_sort='newest' then "registeredAt" end desc,
   case when p_sort='oldest' then "registeredAt" end asc,
   case when p_sort='active' then "lastActiveAt" end desc,id desc limit p_limit offset p_offset)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'filteredTotal',(select count(*) from filtered)) into result;
 return result;
end $$;
revoke all on function public.admin_user_directory(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.admin_user_directory(text,text,text,integer,integer) to service_role;

create or replace function public.create_pending_order(p_user_id uuid,p_sku text,p_target bigint,p_amount numeric)
returns jsonb language plpgsql set search_path='' as $$
declare v_price numeric; v_order public.orders%rowtype;
begin
  -- Revalidate the server price snapshot while holding a shared product/configuration lock.
  if p_sku='subscription' and p_target is null then
    select (commerce->'subscription_price'->>'amount')::numeric into v_price from public.site_config where id=1 for share;
  elsif p_sku='series' then
    select price into v_price from public.series where id=p_target and type in ('collection','handbook','skill') and status='published' for share;
  elsif p_sku='single' then
    select price into v_price from public.articles where id=p_target and type='blog' and series_id is null and access='paid' and status='published' for share;
  elsif p_sku='event' then
    select d.ticket_price into v_price from public.event_details d join public.series s on s.id=d.series_id
      where s.id=p_target and s.type='event' and s.status='published' and d.state in ('upcoming','registering') for share of s,d;
  end if;
  if v_price is null or v_price<=0 or p_amount is null or p_amount<>v_price then raise exception 'NOT_SELLABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || p_user_id::text || ':' || p_sku || ':' || coalesce(p_target::text,''),0));
  if exists(select 1 from public.entitlements e where e.user_id=p_user_id and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
    and (e.type='subscription' or (e.type=p_sku and e.target_id is not distinct from p_target))) then raise exception 'ALREADY_ENTITLED'; end if;
  select * into v_order from public.orders where user_id=p_user_id and sku_type=p_sku
    and target_id is not distinct from p_target and amount=v_price and status='pending' and provider='zpay'
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_order); end if;
  insert into public.orders(user_id,sku_type,target_id,amount) values(p_user_id,p_sku,p_target,v_price) returning * into v_order;
  return to_jsonb(v_order);
end $$;

CREATE OR REPLACE FUNCTION public.commit_publication(p_request_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  fm jsonb := p_payload->'frontmatter';
  item public.articles%rowtype;
  parent public.series%rowtype;
  latest public.article_versions%rowtype;
  diagnostics jsonb := coalesce(p_payload->'diagnostics', '[]'::jsonb);
  item_id bigint;
  next_version integer;
  detail text;
  content_url text;
  base text;
  paths jsonb;
  error_code text;
  error_message text;
begin
  perform pg_catalog.pg_advisory_xact_lock(71001, pg_catalog.hashtext(p_request_id));
  select response into result from public.publish_requests where client_request_id = p_request_id;
  if found then return result; end if;

  if p_payload->>'status' = 'blocked' then
    result := p_payload - 'status' || jsonb_build_object('status', 'blocked');
  else
    perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(fm->>'slug'));
    if fm->>'type' = 'chapter' then
      select * into parent from public.series where slug = fm->>'series_slug' for update;
      if not found then
        error_code := 'SERIES_NOT_FOUND'; error_message := '所属专辑不存在。';
      elsif parent.status = 'archived' then
        error_code := 'SCHEMA_INVALID'; error_message := '不能向已归档专辑发布。';
      end if;
    end if;
    select * into item from public.articles where slug = fm->>'slug' for update;
    if found and (item.status = 'archived' or item.type <> fm->>'type' or item.series_id is distinct from parent.id) then
      error_code := 'SCHEMA_INVALID'; error_message := '不能重发已归档文章或改变现有文章的类型和专辑归属。';
    end if;
    if p_payload ? 'expected_updated_at' and (item.id is null or item.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz) then
      error_code := 'SCHEMA_INVALID'; error_message := '内容已更新，请刷新后重试。';
    end if;
    if item.id is not null and parent.readme_article_id = item.id and fm->>'access' <> 'public' then
      error_code := 'SCHEMA_INVALID'; error_message := 'README 必须公开。';
    end if;
    if error_code is not null then
      diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', error_code, 'severity', 'error', 'message', error_message, 'path', '/frontmatter'));
      result := jsonb_build_object('status', 'blocked', 'diagnostics', diagnostics, 'article', null, 'revalidated', '[]'::jsonb);
    else
      if parent.price > 0 and fm->>'access' = 'subscriber' then
        diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', 'SUBSCRIBER_IN_PAID_SERIES', 'severity', 'warning', 'message', '订阅内容不参与专辑单卖。', 'path', '/frontmatter/access'));
      end if;
      if fm->>'type' = 'blog' then
        base := '/blog'; detail := base || '/' || (fm->>'slug');
      else
        base := case parent.type when 'collection' then '/collections' when 'handbook' then '/handbooks' when 'skill' then '/skills' when 'event' then '/events' end;
        detail := base || '/' || parent.slug;
      end if;
      paths := jsonb_build_array('/', base, detail, '/llms.txt', '/card', '/card.json');
      content_url := detail || case when parent.id is not null then '?article=' || (fm->>'slug') else '' end;
      select * into latest from public.article_versions where article_id = item.id order by version desc limit 1;
      if latest.content_hash = p_payload->>'content_hash' then
        next_version := latest.version;
      else
        insert into public.articles (slug, series_id, type, title, summary, cover_url, tags, access, price, preview_md, status, published_at)
        values (fm->>'slug', parent.id, fm->>'type', fm->>'title', fm->>'summary', p_payload->>'cover',
          array(select jsonb_array_elements_text(coalesce(fm->'tags', '[]'::jsonb))), fm->>'access', (fm->>'price')::numeric,
          p_payload->>'preview', coalesce(nullif(item.status, 'draft'), 'published'), coalesce((fm->>'published_at')::timestamptz, item.published_at, now()))
        on conflict (slug) do update set title = excluded.title, summary = excluded.summary, cover_url = excluded.cover_url,
          tags = excluded.tags, access = excluded.access, price = excluded.price, preview_md = excluded.preview_md,
          status = excluded.status, published_at = excluded.published_at
        returning id into item_id;
        insert into public.article_bodies (article_id, content) values (item_id, p_payload->>'markdown')
          on conflict (article_id) do update set content = excluded.content;
        next_version := coalesce(latest.version, 0) + 1;
        insert into public.article_versions (article_id, version, content_hash, snapshot, client_request_id)
          values (item_id, next_version, p_payload->>'content_hash', p_payload->'snapshot', p_request_id);
        delete from public.article_chunks where article_id = item_id;
        insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
          values (item_id, parent.id, 'public', 'catalog', 0, (fm->>'title') || E'\n' || coalesce(fm->>'summary', ''), content_url);
        if fm->>'access' = 'public' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', case when parent.readme_article_id = item_id then 'readme' else 'body' end, 1, p_payload->>'markdown', content_url);
        elsif coalesce(p_payload->>'preview', '') <> '' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', 'preview', 1, p_payload->>'preview', content_url);
        end if;
      end if;
      result := jsonb_build_object('status', case when jsonb_array_length(diagnostics) > 0 then 'needs_user_action' else 'pass' end,
        'diagnostics', diagnostics, 'article', jsonb_build_object('slug', fm->>'slug', 'version', next_version,
          'url', content_url), 'revalidated', paths);
    end if;
  end if;
  insert into public.publish_requests (client_request_id, status, response) values (p_request_id, result->>'status', result);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.manage_content(p_kind text, p_id bigint, p_expected_updated_at timestamp with time zone, p_action text, p_value text, p_archive_notice boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  album public.series%rowtype;
  article public.articles%rowtype;
  old_status text;
  old_updated timestamptz;
  parent_id bigint;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'message', '需要站主身份');
  end if;
  if p_kind = 'series' then
    select * into album from public.series where id = p_id for update;
    old_status := album.status; old_updated := album.updated_at;
  elsif p_kind = 'article' then
    select series_id into parent_id from public.articles where id = p_id;
    if parent_id is not null then
      select * into album from public.series where id = parent_id for update;
    end if;
    select * into article from public.articles where id = p_id for update;
    old_status := article.status; old_updated := article.updated_at;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的内容类型');
  end if;
  if old_status is null then
    return jsonb_build_object('ok', false, 'message', '内容不存在');
  end if;
  if p_expected_updated_at is null or old_updated <> p_expected_updated_at then
    return jsonb_build_object('ok', false, 'message', '内容已更新，请刷新后重试');
  end if;
  if old_status = 'archived' then
    return jsonb_build_object('ok', false, 'message', '归档内容不可修改或恢复');
  end if;
  if p_action = 'featured' then
    if p_value is null or p_value not in ('true','false') then
      return jsonb_build_object('ok',false,'message','置顶参数无效');
    end if;
    if p_kind = 'series' then update public.series set featured = p_value::boolean where id=p_id;
    else update public.articles set featured = p_value::boolean where id=p_id; end if;
  elsif p_action = 'price' and p_kind = 'series' then
    if album.type = 'event' then return jsonb_build_object('ok',false,'message','活动票价请在活动详情中修改'); end if;
    if p_value is null or p_value !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' then return jsonb_build_object('ok',false,'message','价格需为 0–999999.99，最多两位小数'); end if;
    update public.series set price=p_value::numeric where id=p_id;
  elsif p_action = 'readme' and p_kind = 'series' then
    select * into article from public.articles where slug = p_value for update;
    if article.id is null or article.series_id is distinct from album.id
      or article.access <> 'public' or article.status not in ('published', 'paused') then
      return jsonb_build_object('ok', false, 'message', 'README 必须是本专辑已发布的公开章节');
    end if;
    update public.series set readme_article_id = article.id where id = p_id;
  elsif p_action = 'status' then
    if not ((old_status = 'published' and p_value = 'paused')
      or (old_status = 'paused' and p_value in ('published', 'archived'))
      or (p_kind = 'series' and old_status = 'draft' and p_value = 'published')) or p_value is null then
      return jsonb_build_object('ok', false, 'message', '不允许此状态变更；文章草稿请通过发布工作台发布');
    end if;
    if p_value = 'archived' then
      -- 归档静默（停售时已邮件通知）；时间闸：停售满 3 个月（权益保留期）才可归档。
      if p_archive_notice is distinct from true then
        return jsonb_build_object('ok', false, 'message', '请勾选确认归档');
      end if;
      if (case when p_kind = 'series' then album.paused_at else article.paused_at end) is null
         or (case when p_kind = 'series' then album.paused_at else article.paused_at end) > now() - interval '3 months' then
        return jsonb_build_object('ok', false, 'message', '停售满 3 个月后才可归档（已购权益保留期）');
      end if;
    end if;
    if p_kind = 'series' then
      if p_value = 'published' then
        select * into article from public.articles where id = album.readme_article_id for update;
        if article.id is null or article.series_id is distinct from album.id
          or article.access <> 'public' or article.status not in ('published', 'paused') then
          return jsonb_build_object('ok', false, 'message', '请先设置本专辑已发布的公开 README');
        end if;
        if album.type = 'event' and not exists(select 1 from public.event_details where series_id = album.id) then
          return jsonb_build_object('ok', false, 'message', '请先保存活动详情与票价');
        end if;
      end if;
      update public.series set status = p_value,
        paused_at = case p_value when 'paused' then now() when 'published' then null else paused_at end
      where id = p_id;
    else
      if p_value = 'archived' and album.readme_article_id = article.id and album.status <> 'archived' then
        return jsonb_build_object('ok', false, 'message', '此章节是专辑 README，请先更换 README 或归档专辑');
      end if;
      if p_value = 'published' and album.status = 'archived' then
        return jsonb_build_object('ok', false, 'message', '所属专辑已归档，不能恢复章节');
      end if;
      update public.articles set status = p_value,
        paused_at = case p_value when 'paused' then now() when 'published' then null else paused_at end
      where id = p_id;
    end if;
  else
    return jsonb_build_object('ok', false, 'message', '不支持的操作');
  end if;
  return jsonb_build_object('ok', true, 'message', '已保存');
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_event_details(p_id bigint, p_expected_updated_at timestamp with time zone, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare album public.series%rowtype; previous public.event_details%rowtype; next_state text; price_text text; event_time timestamptz;
begin
  if not public.is_owner() then return jsonb_build_object('ok',false,'message','需要站主身份'); end if;
  select * into album from public.series where id=p_id for update;
  if album.id is null or album.type <> 'event' or album.status='archived' then return jsonb_build_object('ok',false,'message','仅可修改未归档的活动'); end if;
  if p_expected_updated_at is null or album.updated_at<>p_expected_updated_at then return jsonb_build_object('ok',false,'message','内容已更新，请刷新后重试'); end if;
  select * into previous from public.event_details where series_id=p_id for update;
  next_state := p_details->>'state'; price_text := p_details->>'ticket_price';
  if next_state is null or next_state not in ('upcoming','registering','ended') or coalesce(p_details->>'kind','') not in ('open','member')
    or price_text is null or price_text !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$'
    or length(coalesce(p_details->>'location_text',''))>500 or length(coalesce(p_details->>'registration',''))>3000 or length(coalesce(p_details->>'capacity',''))>200 then
    return jsonb_build_object('ok',false,'message','活动字段无效，请检查状态、票价和文字长度');
  end if;
  if (previous.series_id is null and next_state<>'upcoming') or (previous.series_id is not null and not (previous.state=next_state or (previous.state='upcoming' and next_state='registering') or (previous.state='registering' and next_state='ended'))) then
    return jsonb_build_object('ok',false,'message','活动按 即将开始 → 报名中 → 已结束 流转，不可倒退');
  end if;
  begin event_time := (p_details->>'starts_at')::timestamptz;
  exception when others then return jsonb_build_object('ok',false,'message','请输入有效活动时间'); end;
  if event_time is null or not isfinite(event_time) then return jsonb_build_object('ok',false,'message','请输入有效活动时间'); end if;
  insert into public.event_details(series_id,starts_at,location_text,registration,capacity,kind,ticket_price,state)
    values(p_id,event_time,nullif(p_details->>'location_text',''),nullif(p_details->>'registration',''),nullif(p_details->>'capacity',''),p_details->>'kind',price_text::numeric,next_state)
    on conflict(series_id) do update set starts_at=excluded.starts_at,location_text=excluded.location_text,registration=excluded.registration,capacity=excluded.capacity,kind=excluded.kind,ticket_price=excluded.ticket_price,state=excluded.state;
  update public.series set updated_at=now() where id=p_id;
  return jsonb_build_object('ok',true,'message','活动详情已保存');
end;
$function$;

CREATE OR REPLACE FUNCTION public.stage_content_file(p_scope text, p_path text, p_slug text, p_hash text, p_snapshot jsonb, p_expected bigint, p_request text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.content_files%rowtype; r public.content_file_revisions%rowtype; result bigint; base timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(71003, pg_catalog.hashtext(p_scope || '/' || p_path));
  select * into f from public.content_files where scope=p_scope and path=p_path for update;
  select * into r from public.content_file_revisions where file_id=f.id order by version desc limit 1;
  select updated_at into base from public.articles where slug=p_slug;
  if r.input_hash=p_hash and coalesce(r.published_updated_at,r.base_updated_at) is not distinct from base then return r.id; end if;
  if coalesce(r.id,0) <> p_expected then raise exception 'IMPORT_STALE'; end if;
  if f.id is not null and f.article_slug <> p_slug then raise exception 'IMPORT_SLUG_CHANGED'; end if;
  if f.id is null then
    insert into public.content_files(scope,path,article_slug,sort) values(p_scope,p_path,p_slug,(select coalesce(max(sort),0)+1 from public.content_files where scope=p_scope)) returning * into f;
  end if;
  select updated_at into base from public.articles where slug=p_slug;
  insert into public.content_file_revisions(file_id,version,input_hash,snapshot,base_updated_at,request_id)
    values(f.id,coalesce(r.version,0)+1,p_hash,p_snapshot,base,p_request) returning id into result;
  return result;
end $function$;

update public.app_schema_version set version='20261015163748' where id=1;
notify pgrst, 'reload schema';

-- Source migration: 20261015170605_starter_content.sql

set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.starter_imports (
 id text primary key check(id='getting-started-v1'),
 template_hash text not null check(template_hash ~ '^[a-f0-9]{64}$'),
 objects jsonb not null check(jsonb_typeof(objects)='object'),
 published_count integer not null default 0 check(published_count between 0 and 8),
 completed boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.starter_imports enable row level security;
create policy starter_owner_read on public.starter_imports for select to authenticated using((select public.is_owner()));
create policy starter_service on public.starter_imports for all to service_role using(true) with check(true);
revoke all on public.starter_imports from public,anon,authenticated,service_role;
grant select on public.starter_imports to authenticated;
grant select,insert,update on public.starter_imports to service_role;

-- Reserve the page, parent and chapter metadata together. Bodies, versions and
-- chunks are still produced exclusively by the standard publication pipeline.
create function public.prepare_starter_content(p_hash text,p_html text,p_articles jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare job public.starter_imports%rowtype; parent public.series%rowtype; page public.custom_pages%rowtype;
 item public.articles%rowtype; descriptor jsonb; objects jsonb:='[]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('starter-content-v1',0));
 select * into job from public.starter_imports where id='getting-started-v1';
 if found then
   if job.template_hash<>p_hash then raise exception 'STARTER_TEMPLATE_CHANGED'; end if;
   return to_jsonb(job)-'objects';
 end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_html is null or length(p_html)>100000
   or coalesce(jsonb_typeof(p_articles),'')<>'array' or jsonb_array_length(p_articles)<>8 then raise exception 'INVALID_STARTER_TEMPLATE'; end if;
 if exists(select 1 from public.publish_requests where client_request_id ~ '^starter_v1_[0-7]$')
   or exists(select 1 from public.series where slug='getting-started') or exists(select 1 from public.custom_pages where slug='pricing')
   or exists(select 1 from public.articles where slug in(select value->>'slug' from jsonb_array_elements(p_articles))) then raise exception 'STARTER_SLUG_CONFLICT'; end if;
 insert into public.series(slug,type,title,task,price,status,nav_enabled,nav_label,nav_order)
 values('getting-started','collection','使用指南','从部署到发布，了解本站系统的配置与日常使用。',0,'draft',false,'使用指南',100) returning * into parent;
 insert into public.custom_pages(slug,title,description,html,status,placement,nav_label,nav_order)
 values('pricing','收费方案','了解阅读、订阅、内容购买与服务合作。',p_html,'draft','none','收费方案',90) returning * into page;
 for descriptor in select value from jsonb_array_elements(p_articles) loop
   if descriptor->>'slug' is null or descriptor->>'slug' !~ '^[a-z0-9][a-z0-9-]{1,119}$'
     or coalesce(length(descriptor->>'title'),0) not between 1 and 200
     or coalesce(descriptor->>'content_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_STARTER_ARTICLE'; end if;
   insert into public.articles(slug,series_id,type,title,access,status,sort_order)
   values(descriptor->>'slug',parent.id,'chapter',descriptor->>'title','public','draft',jsonb_array_length(objects)) returning * into item;
   objects:=objects||jsonb_build_array(jsonb_build_object('id',item.id,'slug',item.slug,'updated_at',item.updated_at,'content_hash',descriptor->>'content_hash'));
 end loop;
 insert into public.starter_imports(id,template_hash,objects) values('getting-started-v1',p_hash,
   jsonb_build_object('series_id',parent.id,'series_updated_at',parent.updated_at,'page_id',page.id,'page_updated_at',page.updated_at,'articles',objects)) returning * into job;
 return to_jsonb(job)-'objects';
end $$;
revoke all on function public.prepare_starter_content(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_starter_content(text,text,jsonb) to service_role;

-- A checkpoint and publication commit in one transaction. The wrapper narrows
-- the standard authority to reserved, unchanged, public starter chapters.
create function public.commit_starter_publication(p_request_id text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare job public.starter_imports%rowtype; descriptor jsonb; item public.articles%rowtype;
 parent public.series%rowtype; page public.custom_pages%rowtype; result jsonb; step integer;
begin
 select * into job from public.starter_imports where id='getting-started-v1' for update;
 if not found then raise exception 'STARTER_NOT_PREPARED'; end if;
 select response into result from public.publish_requests where client_request_id=p_request_id;
 if found then return result; end if;
 step:=job.published_count;
 if job.completed or step>=8 or p_request_id<>'starter_v1_'||step::text then raise exception 'STARTER_STEP_CHANGED'; end if;
 descriptor:=job.objects->'articles'->step;
 select * into item from public.articles where id=(descriptor->>'id')::bigint for update;
 if not found or item.updated_at is distinct from (descriptor->>'updated_at')::timestamptz
   or item.status<>'draft' or item.series_id<>(job.objects->>'series_id')::bigint
   or p_payload->'frontmatter'->>'slug'<>item.slug or p_payload->'frontmatter'->>'access'<>'public'
   or p_payload->'frontmatter'->>'type'<>'chapter' or p_payload->'frontmatter'->>'series_slug'<>'getting-started'
   or p_payload->>'content_hash' is distinct from descriptor->>'content_hash' then raise exception 'STARTER_CONTENT_CHANGED'; end if;
 if step=7 then
   select * into parent from public.series where id=(job.objects->>'series_id')::bigint for update;
   select * into page from public.custom_pages where id=(job.objects->>'page_id')::bigint for update;
   if parent.updated_at is distinct from (job.objects->>'series_updated_at')::timestamptz or parent.status<>'draft'
     or page.updated_at is distinct from (job.objects->>'page_updated_at')::timestamptz or page.status<>'draft' then raise exception 'STARTER_CONTENT_CHANGED'; end if;
 end if;
 result:=public.commit_publication(p_request_id,p_payload||jsonb_build_object('expected_updated_at',item.updated_at));
 if result->>'status'='blocked' or jsonb_typeof(result->'article') is distinct from 'object' then return result; end if;
 select * into item from public.articles where id=item.id;
 job.objects:=jsonb_set(job.objects,array['articles',step::text,'updated_at'],to_jsonb(item.updated_at));
 if step=7 then
   -- Existing introduction rules: public, published and in this exact parent.
   if (select count(*) from public.articles a where a.id in(select (value->>'id')::bigint from jsonb_array_elements(job.objects->'articles'))
     and a.series_id=parent.id and a.type='chapter' and a.status='published' and a.access='public'
     and a.updated_at=(select (value->>'updated_at')::timestamptz from jsonb_array_elements(job.objects->'articles') where (value->>'id')::bigint=a.id))<>8 then raise exception 'STARTER_CONTENT_CHANGED'; end if;
   update public.series set readme_article_id=(job.objects->'articles'->0->>'id')::bigint,status='published',nav_enabled=true where id=parent.id;
   update public.custom_pages set status='published',placement='nav' where id=page.id;
 end if;
 update public.starter_imports set published_count=step+1,completed=(step=7),objects=job.objects,updated_at=now() where id=job.id;
 return result;
end $$;
revoke all on function public.commit_starter_publication(text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_starter_publication(text,jsonb) to service_role;
update public.app_schema_version set version='20261015170605' where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261016055659_starter_pending_slug_conflicts.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

-- A pending-only document owns its slug before its first publication.
-- Refuse starter initialization before creating any objects in that case.
create or replace function public.prepare_starter_content(p_hash text,p_html text,p_articles jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare job public.starter_imports%rowtype; parent public.series%rowtype; page public.custom_pages%rowtype;
 item public.articles%rowtype; descriptor jsonb; objects jsonb:='[]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('starter-content-v1',0));
 select * into job from public.starter_imports where id='getting-started-v1';
 if found then
   if job.template_hash<>p_hash then raise exception 'STARTER_TEMPLATE_CHANGED'; end if;
   return to_jsonb(job)-'objects';
 end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_html is null or length(p_html)>100000
   or coalesce(jsonb_typeof(p_articles),'')<>'array' or jsonb_array_length(p_articles)<>8 then raise exception 'INVALID_STARTER_TEMPLATE'; end if;
 if exists(select 1 from public.publish_requests where client_request_id ~ '^starter_v1_[0-7]$')
   or exists(select 1 from public.series where slug='getting-started') or exists(select 1 from public.custom_pages where slug='pricing')
   or exists(select 1 from public.articles where slug in(select value->>'slug' from jsonb_array_elements(p_articles)))
   or exists(select 1 from public.content_files where article_slug in(select value->>'slug' from jsonb_array_elements(p_articles))) then raise exception 'STARTER_SLUG_CONFLICT'; end if;
 insert into public.series(slug,type,title,task,price,status,nav_enabled,nav_label,nav_order)
 values('getting-started','collection','使用指南','从部署到发布，了解本站系统的配置与日常使用。',0,'draft',false,'使用指南',100) returning * into parent;
 insert into public.custom_pages(slug,title,description,html,status,placement,nav_label,nav_order)
 values('pricing','收费方案','了解阅读、订阅、内容购买与服务合作。',p_html,'draft','none','收费方案',90) returning * into page;
 for descriptor in select value from jsonb_array_elements(p_articles) loop
   if descriptor->>'slug' is null or descriptor->>'slug' !~ '^[a-z0-9][a-z0-9-]{1,119}$'
     or coalesce(length(descriptor->>'title'),0) not between 1 and 200
     or coalesce(descriptor->>'content_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_STARTER_ARTICLE'; end if;
   insert into public.articles(slug,series_id,type,title,access,status,sort_order)
   values(descriptor->>'slug',parent.id,'chapter',descriptor->>'title','public','draft',jsonb_array_length(objects)) returning * into item;
   objects:=objects||jsonb_build_array(jsonb_build_object('id',item.id,'slug',item.slug,'updated_at',item.updated_at,'content_hash',descriptor->>'content_hash'));
 end loop;
 insert into public.starter_imports(id,template_hash,objects) values('getting-started-v1',p_hash,
   jsonb_build_object('series_id',parent.id,'series_updated_at',parent.updated_at,'page_id',page.id,'page_updated_at',page.updated_at,'articles',objects)) returning * into job;
 return to_jsonb(job)-'objects';
end $$;
revoke all on function public.prepare_starter_content(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_starter_content(text,text,jsonb) to service_role;

update public.app_schema_version set version='20261016055659' where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261018061135_media_library.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

-- Immutable, validated public images. Only descriptive fields can be edited by the owner.
create table public.media_assets (
 id uuid primary key default gen_random_uuid(),
 storage_path text not null unique check(storage_path ~ '^media/[a-z0-9]+(-[a-z0-9]+)*/[a-f0-9]{64}\.(png|jpg|webp|gif)$'),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','image/gif')),
 byte_size integer not null check(byte_size between 1 and 10485760),
 width integer not null check(width between 1 and 20000),
 height integer not null check(height between 1 and 20000),
 name text not null check(length(name) between 1 and 200),
 alt text not null default '' check(length(alt)<=500),
 archived boolean not null default false,
 created_at timestamptz not null default now(),
 check(position('/'||sha256||'.' in storage_path)>0)
);
create index media_assets_catalog_idx on public.media_assets(archived,created_at desc,id desc);
alter table public.media_assets enable row level security;
revoke all on public.media_assets from public,anon,authenticated;
grant select on public.media_assets to authenticated;
grant update(name,alt,archived) on public.media_assets to authenticated;
grant all on public.media_assets to service_role;
create policy media_assets_owner_read on public.media_assets for select to authenticated using((select public.is_owner()));
create policy media_assets_owner_edit on public.media_assets for update to authenticated using((select public.is_owner())) with check((select public.is_owner()));

-- Upload capabilities are never available through the public Data API.
create table public.media_uploads (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 200),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 mime_type text not null check(mime_type in ('image/png','image/jpeg','image/webp','image/gif','image/svg+xml')),
 byte_size integer not null check(byte_size between 1 and 10485760),
 asset_id uuid references public.media_assets(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '2 hours'
);
create index media_uploads_owner_created_idx on public.media_uploads(owner_id,created_at desc);
alter table public.media_uploads enable row level security;
revoke all on public.media_uploads from public,anon,authenticated;
grant all on public.media_uploads to service_role;

create function public.reserve_media_upload(p_id uuid,p_owner uuid,p_name text,p_hash text,p_mime text,p_size integer)
returns jsonb language plpgsql set search_path='' as $$
declare ticket public.media_uploads%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('media-upload:'||p_owner::text,0));
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select * into ticket from public.media_uploads where id=p_id;
 if found then
  if ticket.owner_id<>p_owner or ticket.name<>p_name or ticket.source_hash<>p_hash or ticket.mime_type<>p_mime or ticket.byte_size<>p_size then raise exception 'UPLOAD_CONFLICT'; end if;
  return to_jsonb(ticket)||jsonb_build_object('resumed',true);
 end if;
 if (select count(*) from public.media_uploads where owner_id=p_owner and created_at>now()-interval '15 minutes')>=600 then raise exception 'UPLOAD_RATE_LIMIT'; end if;
 insert into public.media_uploads(id,owner_id,name,source_hash,mime_type,byte_size) values(p_id,p_owner,p_name,p_hash,p_mime,p_size) returning * into ticket;
 return to_jsonb(ticket)||jsonb_build_object('resumed',false);
end $$;
revoke all on function public.reserve_media_upload(uuid,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_media_upload(uuid,uuid,text,text,text,integer) to service_role;

-- Return only counts, on demand. Hash matching conservatively includes legacy URLs
-- and alternate storage paths for the same bytes; unsaved browser drafts cannot be counted.
create function public.media_asset_usage(p_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare digest text;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 select sha256 into digest from public.media_assets where id=p_id;
 if digest is null then raise exception 'ASSET_NOT_FOUND'; end if;
 return jsonb_build_object(
  'articles',(select count(*) from public.articles a left join public.article_bodies b on b.article_id=a.id where position(digest in coalesce(b.content,'')||coalesce(a.cover_url,''))>0),
  'versions',(select count(*) from public.article_versions where position(digest in snapshot::text)>0),
  'revisions',(select count(*) from public.content_file_revisions where position(digest in snapshot::text)>0),
  'imports',(select count(*) from public.content_assets where position(digest in media::text)>0),
  'pages',(select count(*) from public.custom_pages where position(digest in html)>0),
  'settings',(select count(*) from public.site_config where position(digest in identity::text||home_config::text||contact::text||commerce::text)>0));
end $$;
revoke all on function public.media_asset_usage(uuid) from public,anon,authenticated;
grant execute on function public.media_asset_usage(uuid) to authenticated;

-- Keep the no-argument snapshot compatible with an application rollback.
-- The opted-in overload adds the catalog to the same statement snapshot.
create function public.export_site_snapshot(p_include_media boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when p_include_media then jsonb_set(public.export_site_snapshot(),'{rows,media_assets}',
   (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.media_assets t),true)
 else public.export_site_snapshot() end;
$$;
revoke all on function public.export_site_snapshot(boolean) from public,anon,authenticated;
grant execute on function public.export_site_snapshot(boolean) to service_role;

update public.app_schema_version set version='20261018061135' where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261020090813_backend_turnstile_settings.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

-- Public widget configuration is separate from the private verification credential.
-- NULL preserves existing environment configuration until the owner explicitly saves.
alter table public.site_config add column turnstile_config jsonb;
alter table public.site_config add constraint site_config_turnstile_shape check (
 turnstile_config is null or (
  jsonb_typeof(turnstile_config)='object'
  and turnstile_config ?& array['enabled','site_key']
  and jsonb_typeof(turnstile_config->'enabled')='boolean'
  and jsonb_typeof(turnstile_config->'site_key')='string'
  and length(turnstile_config->>'site_key')<=200
  and (turnstile_config - array['enabled','site_key'])='{}'::jsonb
  and (not (turnstile_config->>'enabled')::boolean or turnstile_config->>'site_key' ~ '^[A-Za-z0-9_-]{10,200}$')
 ));

create function public.save_turnstile_settings(p_expected timestamptz,p_enabled boolean,p_site_key text,p_secret text,p_clear boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_site public.site_config%rowtype; saved_secret text;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 select * into current_site from public.site_config where id=1 for update;
 if not found or current_site.updated_at is distinct from p_expected then raise exception 'SETTINGS_CONFLICT'; end if;
 if p_enabled is null or p_clear is null or p_site_key is null or length(p_site_key)>200
   or (p_site_key<>'' and p_site_key !~ '^[A-Za-z0-9_-]{10,200}$')
   or p_secret is null or length(p_secret)>200
   or (p_secret<>'' and p_secret !~ '^[A-Za-z0-9_-]{10,200}$') then raise exception 'INVALID_TURNSTILE_CONFIG'; end if;
 select value into saved_secret from public.site_secrets where key='turnstile_secret_key';
 if p_clear then saved_secret:=null;
 elsif p_secret<>'' then saved_secret:=p_secret;
 end if;
 if p_enabled and (p_site_key='' or coalesce(saved_secret,'')='') then raise exception 'TURNSTILE_PAIR_REQUIRED'; end if;
 if p_enabled and p_site_key is distinct from current_site.turnstile_config->>'site_key' and p_secret='' then
  raise exception 'TURNSTILE_NEW_PAIR_REQUIRED';
 end if;
 if p_clear then delete from public.site_secrets where key='turnstile_secret_key';
 elsif p_secret<>'' then
  insert into public.site_secrets(key,value,updated_at) values('turnstile_secret_key',p_secret,now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
 end if;
 update public.site_config set turnstile_config=jsonb_build_object('enabled',p_enabled,'site_key',p_site_key) where id=1;
 return jsonb_build_object('updated_at',(select updated_at from public.site_config where id=1));
end $$;
revoke all on function public.save_turnstile_settings(timestamptz,boolean,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.save_turnstile_settings(timestamptz,boolean,text,text,boolean) to authenticated;

update public.app_schema_version set version='20261020090813' where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261020110612_private_ai_settings.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

-- Immutable connection versions let an active index retain its own model/key during a rebuild.
create table public.ai_connections (
 id uuid primary key default gen_random_uuid(),
 purpose text not null check(purpose in ('generation','embedding')),
 protocol text not null check(protocol in ('chat','responses','messages','embeddings')),
 base_url text not null,
 model text not null check(model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'),
 api_key text not null check(length(api_key) between 10 and 1024 and api_key ~ '^[!-~]+$'),
 verified_at timestamptz,
 probe_summary jsonb,
 created_at timestamptz not null default now(),
 constraint ai_connection_target check (
  (purpose='embedding' and protocol='embeddings' and base_url='https://api.siliconflow.cn/v1' and model='BAAI/bge-m3') or
  (purpose='generation' and (
   (base_url in ('https://api.openai.com/v1','https://api.deepseek.com') and protocol in ('chat','responses')) or
   (base_url='https://api.siliconflow.cn/v1' and protocol='chat') or
   (base_url='https://api.anthropic.com/v1' and protocol='messages'))))
);
create table public.ai_settings (
 id integer primary key check(id=1),
 revision uuid not null default gen_random_uuid(),
 generation_connection uuid references public.ai_connections(id),
 embedding_connection uuid references public.ai_connections(id),
 embedding_key_shared boolean not null default false,
 avatar_enabled boolean not null default false,
 anonymous_entry boolean not null default false,
 owner_instructions text not null default '用简体中文简洁回答本站内容、服务与使用问题；资料不足时说明缺少什么，并引导访客查看相关内容或联系站主。' check(length(owner_instructions)<=8000),
 monthly_limit integer check(monthly_limit between 0 and 1000000),
 updated_at timestamptz not null default now()
);
insert into public.ai_settings(id) values(1);
create table public.ai_calls (
 request_id uuid primary key,
 task text not null check(task in ('avatar','page','generation_probe','embedding_probe','retrieval')),
 connection_id uuid not null references public.ai_connections(id),
 user_id uuid references auth.users(id) on delete set null,
 ip text check(length(ip)<=128),
 state text not null check(state in ('reserved','dispatched','succeeded','unknown','released')),
 tokens_in integer not null default 0 check(tokens_in>=0),
 tokens_out integer not null default 0 check(tokens_out>=0),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index ai_calls_subject_time on public.ai_calls(user_id,created_at);
create index ai_calls_ip_time on public.ai_calls(ip,created_at) where user_id is null;
create index ai_calls_time_task on public.ai_calls(created_at,task);

-- No browser role, including an owner JWT, can directly access credentials or call accounting.
alter table public.ai_connections enable row level security;
alter table public.ai_settings enable row level security;
alter table public.ai_calls enable row level security;
revoke all on public.ai_connections,public.ai_settings,public.ai_calls from public,anon,authenticated;
grant select,insert,update,delete on public.ai_connections,public.ai_settings,public.ai_calls to service_role;

create function public.guard_ai_connection_version() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (new.id,new.purpose,new.protocol,new.base_url,new.model,new.api_key,new.created_at)
  is distinct from (old.id,old.purpose,old.protocol,old.base_url,old.model,old.api_key,old.created_at) then
  raise exception 'AI_CONNECTION_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger ai_connection_version before update on public.ai_connections
 for each row execute function public.guard_ai_connection_version();
revoke all on function public.guard_ai_connection_version() from public,anon,authenticated,service_role;

create function public.ai_save_connection(p_previous uuid,p_definition jsonb,p_key text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare previous public.ai_connections; result_id uuid; candidate_key text;
begin
 if p_definition is null or p_key is null or jsonb_typeof(p_definition)<>'object'
  or p_definition - array['purpose','protocol','baseUrl','model'] <> '{}'::jsonb
  or not(p_definition ?& array['purpose','protocol','baseUrl','model']) then raise exception 'INVALID_AI_CONNECTION'; end if;
 if coalesce(p_definition->>'model','') !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
  or not ((p_definition->>'purpose'='embedding' and p_definition->>'protocol'='embeddings' and p_definition->>'baseUrl'='https://api.siliconflow.cn/v1' and p_definition->>'model'='BAAI/bge-m3')
   or (p_definition->>'purpose'='generation' and (
    (p_definition->>'baseUrl' in ('https://api.openai.com/v1','https://api.deepseek.com') and p_definition->>'protocol' in ('chat','responses'))
    or (p_definition->>'baseUrl'='https://api.siliconflow.cn/v1' and p_definition->>'protocol'='chat')
    or (p_definition->>'baseUrl'='https://api.anthropic.com/v1' and p_definition->>'protocol'='messages')))) then raise exception 'INVALID_AI_CONNECTION'; end if;
 if p_previous is not null then select * into previous from public.ai_connections where id=p_previous; end if;
 candidate_key:=nullif(p_key,'');
 if candidate_key is null then
  if previous.id is null or previous.base_url is distinct from p_definition->>'baseUrl'
   or previous.purpose is distinct from p_definition->>'purpose' then raise exception 'AI_TARGET_KEY_REQUIRED'; end if;
  candidate_key:=previous.api_key;
 end if;
 if length(candidate_key) not between 10 and 1024 or candidate_key !~ '^[!-~]+$' then raise exception 'INVALID_AI_KEY'; end if;
 if previous.id is not null and previous.purpose=p_definition->>'purpose'
  and previous.protocol=p_definition->>'protocol' and previous.base_url=p_definition->>'baseUrl'
  and previous.model=p_definition->>'model' and previous.api_key=candidate_key then return previous.id; end if;
 insert into public.ai_connections(purpose,protocol,base_url,model,api_key)
 values(p_definition->>'purpose',p_definition->>'protocol',p_definition->>'baseUrl',p_definition->>'model',candidate_key)
 returning id into result_id;
 return result_id;
end $$;

create function public.save_ai_settings(p_owner uuid,p_expected uuid,p_generation jsonb,p_generation_key text,
 p_embedding jsonb,p_embedding_key text,p_reuse_key boolean,p_avatar jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_config public.ai_settings; generation_id uuid; embedding_id uuid; generation public.ai_connections;
 enabled boolean; anonymous_enabled boolean; instructions text; monthly integer;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select * into current_config from public.ai_settings where id=1 for update;
 if not found or current_config.revision is distinct from p_expected then raise exception 'SETTINGS_CONFLICT'; end if;
 if p_reuse_key is null or p_generation_key is null or p_embedding_key is null or p_avatar is null
  or jsonb_typeof(p_avatar)<>'object' or p_avatar - array['enabled','anonymousEntry','instructions','monthlyLimit'] <> '{}'::jsonb
  or not(p_avatar ?& array['enabled','anonymousEntry','instructions','monthlyLimit'])
  or jsonb_typeof(p_avatar->'enabled')<>'boolean' or jsonb_typeof(p_avatar->'anonymousEntry')<>'boolean'
  or jsonb_typeof(p_avatar->'instructions')<>'string'
  or jsonb_typeof(p_avatar->'monthlyLimit') not in ('number','null') then raise exception 'INVALID_AI_SETTINGS'; end if;
 enabled:=(p_avatar->>'enabled')::boolean; anonymous_enabled:=(p_avatar->>'anonymousEntry')::boolean;
 instructions:=p_avatar->>'instructions'; monthly:=(p_avatar->>'monthlyLimit')::integer;
 if p_generation is not null then
  if p_generation->>'purpose' is distinct from 'generation' then raise exception 'INVALID_AI_CONNECTION'; end if;
  generation_id:=public.ai_save_connection(current_config.generation_connection,p_generation,p_generation_key);
  select * into generation from public.ai_connections where id=generation_id;
 elsif p_generation_key<>'' then raise exception 'INVALID_AI_CONNECTION'; end if;
 if p_embedding is not null then
  if p_embedding->>'purpose' is distinct from 'embedding' then raise exception 'INVALID_AI_CONNECTION'; end if;
  if p_reuse_key then
   if generation.id is null or generation.base_url is distinct from p_embedding->>'baseUrl' or p_embedding_key<>'' then raise exception 'AI_SHARED_KEY_TARGET_MISMATCH'; end if;
   embedding_id:=public.ai_save_connection(current_config.embedding_connection,p_embedding,generation.api_key);
  else embedding_id:=public.ai_save_connection(current_config.embedding_connection,p_embedding,p_embedding_key);
  end if;
 elsif p_reuse_key or p_embedding_key<>'' then raise exception 'INVALID_AI_CONNECTION'; end if;
 update public.ai_settings set generation_connection=generation_id,embedding_connection=embedding_id,
  embedding_key_shared=p_reuse_key,avatar_enabled=enabled,anonymous_entry=anonymous_enabled,
  owner_instructions=instructions,monthly_limit=monthly,revision=gen_random_uuid(),updated_at=clock_timestamp() where id=1;
 -- The index readiness trigger updates the public availability projection.
 return jsonb_build_object('revision',(select revision from public.ai_settings where id=1));
end $$;

create function public.reserve_ai_call(p_request uuid,p_task text,p_connection uuid,p_user uuid,p_ip text)
returns text language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; old_call public.ai_calls; owner_user boolean; cap integer; v_now timestamptz; start_day timestamptz;
begin
 if p_request is null or p_task is null or p_task not in ('avatar','page','generation_probe','embedding_probe','retrieval')
  or p_connection is null or length(coalesce(p_ip,''))>128 or (p_user is null and nullif(p_ip,'') is null) then raise exception 'INVALID_AI_CALL'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'AI_BUDGET_REQUIRES_READ_COMMITTED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-call-budget',0));
 v_now:=clock_timestamp();start_day:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 select * into old_call from public.ai_calls where request_id=p_request;
 if found then
  if old_call.task is distinct from p_task or old_call.connection_id is distinct from p_connection
   or old_call.user_id is distinct from p_user or old_call.ip is distinct from p_ip then raise exception 'AI_CALL_MISMATCH'; end if;
  return 'duplicate';
 end if;
 select * into cfg from public.ai_settings where id=1;
 if p_user is not null then
  select is_owner into owner_user from public.profiles where id=p_user;
  if not found then raise exception 'INVALID_AI_PRINCIPAL'; end if;
 else owner_user:=false; end if;
 if p_task in ('page','generation_probe','embedding_probe') and not owner_user then raise exception 'OWNER_REQUIRED'; end if;
 if p_task in ('avatar','retrieval') and (not cfg.avatar_enabled or
  not exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true') or (p_user is null and not cfg.anonymous_entry)) then return 'disabled'; end if;
 if p_task in ('page','avatar','generation_probe') and p_connection is distinct from cfg.generation_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task='embedding_probe' and p_connection is distinct from cfg.embedding_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task not in ('generation_probe','embedding_probe') and not exists(select 1 from public.ai_connections where id=p_connection and verified_at is not null) then return 'unverified'; end if;
 cap:=case when p_task in ('generation_probe','embedding_probe') then 20 when p_task='page' then 60
  when p_task='retrieval' then case when p_user is null then 15 else 300 end
  when p_user is null then 5
  when exists(select 1 from public.entitlements where user_id=p_user and revoked_at is null and type='subscription'
    and starts_at<=v_now and (ends_at is null or ends_at>v_now)) then 100 else 20 end;
 if (not owner_user or p_task<>'avatar') and ((select count(*) from public.ai_calls where created_at>=start_day and task=p_task
   and state<>'released' and (state<>'reserved' or expires_at>v_now)
   and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) +
   case when p_task='avatar' then (select count(*) from public.avatar_usage where created_at>=start_day and generation_state<>'released'
    and (generation_state<>'reserved' or reservation_expires_at>v_now)
    and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) else 0 end)>=cap then return 'daily_limit'; end if;
 if (select count(*) from public.ai_calls where created_at>v_now-interval '1 minute' and task=p_task
   and state<>'released' and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end)>=5 then return 'rate_limit'; end if;
 if p_task in ('avatar','page') and cfg.monthly_limit is not null and (
  (select count(*) from public.ai_calls where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and task in ('avatar','page') and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now)))>=cfg.monthly_limit then return 'monthly_limit'; end if;
 insert into public.ai_calls(request_id,task,connection_id,user_id,ip,state,expires_at,created_at)
 values(p_request,p_task,p_connection,p_user,p_ip,'reserved',v_now+interval '60 seconds',v_now);
 return 'reserved';
end $$;
create function public.dispatch_ai_call(p_request uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 update public.ai_calls set state='dispatched' where request_id=p_request and state='reserved' and expires_at>clock_timestamp()
  and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'
  and exists(select 1 from public.ai_settings s where s.id=1 and
   case when task in ('avatar','page','generation_probe') then s.generation_connection=connection_id
    when task='embedding_probe' then s.embedding_connection=connection_id else true end
   and (task not in ('avatar','retrieval') or (s.avatar_enabled and (user_id is not null or s.anonymous_entry)
    and exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true'))))
  returning request_id into changed;
 return changed is not null;
end $$;
create function public.finish_ai_call(p_request uuid,p_outcome text,p_tokens_in integer default 0,p_tokens_out integer default 0) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 if p_outcome is null or p_outcome not in ('succeeded','unknown','released') or p_tokens_in is null or p_tokens_out is null
  or p_tokens_in<0 or p_tokens_out<0 then raise exception 'INVALID_AI_OUTCOME'; end if;
 update public.ai_calls set state=p_outcome,tokens_in=p_tokens_in,tokens_out=p_tokens_out where request_id=p_request
  and ((state='reserved' and p_outcome='released') or (state='dispatched' and p_outcome in ('succeeded','unknown')))
  returning request_id into changed;
 return changed is not null;
end $$;
revoke all on function public.ai_save_connection(uuid,jsonb,text),public.save_ai_settings(uuid,uuid,jsonb,text,jsonb,text,boolean,jsonb),
 public.reserve_ai_call(uuid,text,uuid,uuid,text),public.dispatch_ai_call(uuid),public.finish_ai_call(uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.ai_save_connection(uuid,jsonb,text),public.save_ai_settings(uuid,uuid,jsonb,text,jsonb,text,boolean,jsonb),
 public.reserve_ai_call(uuid,text,uuid,uuid,text),public.dispatch_ai_call(uuid),public.finish_ai_call(uuid,text,integer,integer) to service_role;

-- Self-only aggregate; clients cannot read the private call ledger or choose another user.
create function public.avatar_usage_today() returns bigint
language plpgsql stable security definer set search_path='' as $$
declare principal uuid:=auth.uid(); v_now timestamptz:=now(); day_start timestamptz;
begin
 if principal is null then raise exception 'AUTH_REQUIRED'; end if;
 day_start:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 return (select count(*) from public.ai_calls where user_id=principal and task='avatar' and created_at>=day_start
  and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where user_id=principal and created_at>=day_start
   and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now));
end $$;
revoke all on function public.avatar_usage_today() from public,anon,authenticated,service_role;
grant execute on function public.avatar_usage_today() to authenticated;

-- The owner sees aggregate usage, never credentials or other users' call rows.
create or replace function public.admin_dashboard_card(p_section text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare month_start timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 if p_section='revenue' then return jsonb_build_object('revenueThisMonth',(select coalesce(sum(amount),0) from public.orders where status in ('paid','fulfilled') and updated_at>=month_start));
 elsif p_section='subscriptions' then return jsonb_build_object('activeSubscriptions',(select count(distinct user_id) from public.entitlements where type='subscription' and revoked_at is null and starts_at<=now() and (ends_at is null or ends_at>now())));
 elsif p_section='content' then return jsonb_build_object('seriesPublished',(select count(*) from public.series where status='published'),'articlesPublished',(select count(*) from public.articles where status='published'));
 elsif p_section='avatar' then return jsonb_build_object(
  'avatarGenerationsThisMonth',
   (select count(*) from public.avatar_usage where created_at>=month_start and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>now())) +
   (select count(*) from public.ai_calls where task='avatar' and created_at>=month_start and state<>'released' and (state<>'reserved' or expires_at>now())),
  'avatarGenerationsTotal',
   (select count(*) from public.avatar_usage where generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>now())) +
   (select count(*) from public.ai_calls where task='avatar' and state<>'released' and (state<>'reserved' or expires_at>now())),
  'avatarCacheHitsTotal',(select coalesce(sum(hit_count),0) from public.avatar_cache));
 else raise exception 'INVALID_METRIC'; end if;
end $$;
revoke all on function public.admin_dashboard_card(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_dashboard_card(text) to authenticated;
update public.app_schema_version set version='20261020110612',applied_at=now() where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261020112058_knowledge_index_generations.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.knowledge_index_generations (
 id uuid primary key default gen_random_uuid(),
 connection_id uuid not null references public.ai_connections(id),
 created_by uuid not null references auth.users(id),
 state text not null default 'building' check(state in ('building','ready','active','retired','failed')),
 preprocessing text not null default 'utf8-paragraph-v1' check(preprocessing='utf8-paragraph-v1'),
 approved_revision bigint not null,
 scan_cursor text not null default '',
 scan_complete boolean not null default false,
 provider_attempts integer not null default 0,
 threshold double precision check(threshold between -1 and 1),
 evaluation jsonb,
 evaluated_revision bigint,
 created_at timestamptz not null default now()
);
create unique index knowledge_one_active on public.knowledge_index_generations((true)) where state='active';
create unique index knowledge_one_pending on public.knowledge_index_generations((true)) where state in ('building','ready');
create table public.knowledge_index_control (
 id integer primary key check(id=1),
 source_revision bigint not null default 0,
 active_generation uuid references public.knowledge_index_generations(id)
);
insert into public.knowledge_index_control(id) values(1);
create table public.knowledge_index_items (
 id uuid primary key default gen_random_uuid(),
 generation_id uuid not null references public.knowledge_index_generations(id) on delete cascade,
 source_key text not null,
 source_hash text not null check(source_hash ~ '^[0-9a-f]{64}$'),
 part integer not null check(part>=0),
 start_char integer not null check(start_char>=0),
 end_char integer not null check(end_char>start_char),
 content text not null check(octet_length(content) between 1 and 2048),
 embedding extensions.vector(1024),
 state text not null default 'pending' check(state in ('pending','leased','ready','failed','obsolete')),
 lease_id uuid,
 lease_expires_at timestamptz,
 attempts integer not null default 0,
 last_error text check(last_error ~ '^[A-Z0-9_]{1,80}$'),
 unique(generation_id,source_key,source_hash,part),
 check(state<>'ready' or (embedding is not null and extensions.vector_norm(embedding)>0)),
 check((state='leased')=(lease_id is not null and lease_expires_at is not null))
);
create index knowledge_items_source on public.knowledge_index_items(source_key,source_hash);
create index knowledge_items_claim on public.knowledge_index_items(generation_id,state,id);

create table public.knowledge_evaluations (
 id uuid primary key default gen_random_uuid(),
 generation_id uuid not null references public.knowledge_index_generations(id) on delete cascade,
 source_revision bigint not null,
 digest text not null check(digest ~ '^[0-9a-f]{64}$'),
 cases jsonb not null check(jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 40 and 100),
 results jsonb not null default '[]' check(jsonb_typeof(results)='array'),
 next_case integer not null default 0 check(next_case>=0),
 state text not null default 'pending' check(state in ('pending','leased','failed','complete')),
 lease_id uuid,
 lease_expires_at timestamptz,
 leased_count integer not null default 0 check(leased_count between 0 and 16),
 attempts integer not null default 0,
 check((state='leased')=(lease_id is not null and lease_expires_at is not null)),
 unique(generation_id,source_revision,digest)
);
alter table public.knowledge_evaluations enable row level security;
revoke all on public.knowledge_evaluations from public,anon,authenticated;
grant select,insert,update,delete on public.knowledge_evaluations to service_role;

alter table public.knowledge_index_generations enable row level security;
alter table public.knowledge_index_control enable row level security;
alter table public.knowledge_index_items enable row level security;
revoke all on public.knowledge_index_generations,public.knowledge_index_control,public.knowledge_index_items from public,anon,authenticated;
grant select,insert,update,delete on public.knowledge_index_generations,public.knowledge_index_control,public.knowledge_index_items to service_role;

-- Only current published/paused sources. Raw conversations never appear in this view.
create view public.knowledge_sources with(security_invoker=true) as
select s.source_key,s.target,s.article_id,s.chunk_type,s.access,s.content,
 encode(sha256(convert_to(s.content,'UTF8')),'hex') source_hash
from (
 select 'chunk:'||c.id source_key,'article:'||a.slug target,a.id article_id,c.chunk_type,a.access,
  replace(replace(c.content,chr(13)||chr(10),chr(10)),chr(13),chr(10)) content
 from public.article_chunks c join public.articles a on a.id=c.article_id
 left join public.series p on p.id=a.series_id
 where a.status in ('published','paused') and (a.type='blog' or (p.id is not null and p.status in ('published','paused')))
 union all
 select 'qa:'||q.conversation_id,case when a.id is null then 'qa:'||q.conversation_id else 'article:'||a.slug end,
  q.article_id,'qa'::text as chunk_type,'public'::text as access,replace(replace('问题：'||q.question_md||chr(10)||chr(10)||'回答：'||q.answer_md,chr(13)||chr(10),chr(10)),chr(13),chr(10)) as content
 from public.conversation_publications q left join public.articles a on a.id=q.article_id
 left join public.series p on p.id=a.series_id
 where q.article_id is null or (a.status in ('published','paused') and (a.type='blog' or (p.id is not null and p.status in ('published','paused'))))
) s where length(btrim(s.content))>0;
revoke all on public.knowledge_sources from public,anon,authenticated;
grant select on public.knowledge_sources to service_role;

create function public.refresh_ai_public_state() returns boolean
language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; available boolean; projection jsonb;
begin
 select * into cfg from public.ai_settings where id=1;
 available:=cfg.avatar_enabled and cfg.embedding_connection is not null
  and exists(select 1 from public.ai_connections where id=cfg.generation_connection and verified_at is not null)
  and exists(select 1 from public.knowledge_index_control c join public.knowledge_index_generations g on g.id=c.active_generation
   join public.ai_connections k on k.id=g.connection_id where c.id=1 and g.state='active' and k.verified_at is not null
   and exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
    where i.generation_id=g.id and i.state='ready'));
 projection:=jsonb_strip_nulls(jsonb_build_object('enabled',coalesce(available,false),'anonymous_entry',cfg.anonymous_entry,'monthly_limit',cfg.monthly_limit));
 if available then projection:=projection||'{"knowledge_ready":true}'::jsonb; end if;
 update public.site_config set avatar_config=projection where id=1 and avatar_config is distinct from projection;
 return coalesce(available,false);
end $$;

-- Trigger code has no public entry point. Source writes already require owner/service authority.
create schema if not exists ai_internal;
revoke all on schema ai_internal from public,anon,authenticated;
create function ai_internal.knowledge_sources_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.knowledge_index_control set source_revision=source_revision+1 where id=1;
 update public.knowledge_index_generations set scan_cursor='',scan_complete=false,evaluation=null,evaluated_revision=null,
  state=case when state='ready' then 'building' else state end where state in ('building','ready','active');
 perform public.refresh_ai_public_state();
 return null;
end $$;
revoke all on function ai_internal.knowledge_sources_changed() from public,anon,authenticated,service_role;
create trigger knowledge_chunk_changed after insert or update or delete on public.article_chunks
 for each statement execute function ai_internal.knowledge_sources_changed();
create trigger knowledge_article_changed after insert or update or delete on public.articles
 for each statement execute function ai_internal.knowledge_sources_changed();
create trigger knowledge_series_changed after insert or update or delete on public.series
 for each statement execute function ai_internal.knowledge_sources_changed();
create trigger knowledge_publication_changed after insert or update or delete on public.conversation_publications
 for each statement execute function ai_internal.knowledge_sources_changed();
create function ai_internal.ai_configuration_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.refresh_ai_public_state();
 return null;
end $$;
revoke all on function ai_internal.ai_configuration_changed() from public,anon,authenticated,service_role;
create trigger ai_settings_public_state after update on public.ai_settings
 for each statement execute function ai_internal.ai_configuration_changed();

create function public.begin_knowledge_index(p_owner uuid,p_consent boolean,p_generation uuid default null,p_expected_revision bigint default null,p_expected_connection uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare epoch bigint; selected_connection uuid; result_id uuid;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_consent is distinct from true then raise exception 'KNOWLEDGE_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 if p_expected_revision is not null and p_expected_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_generation is not null then
  if exists(select 1 from public.knowledge_index_generations where id=p_generation and state='failed')
   and exists(select 1 from public.knowledge_index_generations where id<>p_generation and state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
  update public.knowledge_index_generations set approved_revision=epoch,state=case when state='failed' then 'building' else state end
   where id=p_generation and state in ('building','active','failed') returning id into result_id;
  if result_id is null then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
  return result_id;
 end if;
 select s.embedding_connection into selected_connection from public.ai_settings s join public.ai_connections c on c.id=s.embedding_connection
  where s.id=1 and c.verified_at is not null;
 if selected_connection is null then raise exception 'KNOWLEDGE_CONNECTION_UNVERIFIED'; end if;
 if p_expected_connection is not null and selected_connection<>p_expected_connection then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 if not exists(select 1 from public.knowledge_sources) then raise exception 'KNOWLEDGE_EMPTY'; end if;
 if exists(select 1 from public.knowledge_index_generations where state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
 insert into public.knowledge_index_generations(connection_id,created_by,approved_revision) values(selected_connection,p_owner,epoch) returning id into result_id;
 return result_id;
end $$;

create function public.register_knowledge_source(p_generation uuid,p_source text,p_hash text,p_parts jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations; source public.knowledge_sources; v_part jsonb; position_char integer:=0; n integer:=0; expected text;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','active') then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
 if generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 select * into source from public.knowledge_sources where source_key=p_source;
 if not found or source.source_hash is distinct from p_hash then return false; end if;
 if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts) not between 1 and 4096 then raise exception 'KNOWLEDGE_PARTS_INVALID'; end if;
 for v_part in select value from jsonb_array_elements(p_parts) loop
  if (v_part->>'start')::integer is distinct from position_char or (v_part->>'end')::integer<=position_char then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
  expected:=substring(source.content from position_char+1 for (v_part->>'end')::integer-position_char);
  if v_part->>'content' is distinct from expected or octet_length(expected) not between 1 and 2048 then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
  insert into public.knowledge_index_items(generation_id,source_key,source_hash,part,start_char,end_char,content)
   values(p_generation,p_source,p_hash,n,position_char,(v_part->>'end')::integer,expected) on conflict(generation_id,source_key,source_hash,part) do update
    set state=case when knowledge_index_items.state='obsolete' then case when knowledge_index_items.embedding is null then 'pending' else 'ready' end else knowledge_index_items.state end;
  position_char:=(v_part->>'end')::integer;n:=n+1;
 end loop;
 if position_char<>length(source.content) then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
 update public.knowledge_index_items set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation and source_key=p_source and source_hash<>p_hash;
 update public.knowledge_index_generations set scan_cursor=greatest(scan_cursor,p_source) where id=p_generation;
 return true;
end $$;

create function public.complete_knowledge_scan(p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','active') or generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if exists(select 1 from public.knowledge_sources where source_key>generation.scan_cursor) then return false; end if;
 update public.knowledge_index_generations set scan_complete=true where id=p_generation;
 update public.knowledge_index_items i set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation
  and not exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash);
 return true;
end $$;

create function public.claim_knowledge_batch(p_generation uuid,p_lease uuid)
returns table(item_id uuid,content text) language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if p_lease is null then raise exception 'KNOWLEDGE_LEASE_INVALID'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','active') or not generation.scan_complete then raise exception 'KNOWLEDGE_SCAN_REQUIRED'; end if;
 if generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 update public.knowledge_index_items set state='failed',last_error='LEASE_EXPIRED_UNKNOWN',lease_id=null,lease_expires_at=null
  where generation_id=p_generation and state='leased' and lease_expires_at<=clock_timestamp();
 if exists(select 1 from public.knowledge_index_items where generation_id=p_generation and state='failed') then return; end if;
 return query with selected as (
  select i.id from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
  where i.generation_id=p_generation and i.state='pending' order by i.id for update of i skip locked limit 16
 ), changed as (
  update public.knowledge_index_items i set state='leased',lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1
  from selected where i.id=selected.id returning i.id,i.content
 ) select id,changed.content from changed;
 if found then update public.knowledge_index_generations set provider_attempts=provider_attempts+1 where id=p_generation; end if;
end $$;

create function public.finish_knowledge_batch(p_generation uuid,p_lease uuid,p_vectors jsonb,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare leased integer; item jsonb; row_id uuid; parsed extensions.vector(1024);
begin
 perform 1 from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state in ('building','active') for update;
 if not found then return false; end if;
 select count(*) into leased from public.knowledge_index_items where generation_id=p_generation and state='leased' and lease_id=p_lease and lease_expires_at>clock_timestamp();
 if leased=0 then return false; end if;
 if p_error is not null then
  if p_error !~ '^[A-Z0-9_]{1,80}$' then raise exception 'KNOWLEDGE_ERROR_INVALID'; end if;
  update public.knowledge_index_items set state='failed',last_error=p_error,lease_id=null,lease_expires_at=null where generation_id=p_generation and state='leased' and lease_id=p_lease;
  return true;
 end if;
 if jsonb_typeof(p_vectors)<>'array' or jsonb_array_length(p_vectors)<>leased
  or (select count(distinct value->>'id') from jsonb_array_elements(p_vectors))<>leased then raise exception 'KNOWLEDGE_VECTOR_COUNT_INVALID'; end if;
 for item in select value from jsonb_array_elements(p_vectors) loop
  row_id:=(item->>'id')::uuid; parsed:=(item->>'vector')::extensions.vector(1024);
  if parsed is null or extensions.vector_norm(parsed)<=0 then raise exception 'KNOWLEDGE_VECTOR_INVALID'; end if;
  if not exists(select 1 from public.knowledge_index_items where id=row_id and generation_id=p_generation and state='leased' and lease_id=p_lease and lease_expires_at>clock_timestamp()) then raise exception 'KNOWLEDGE_LEASE_LOST'; end if;
  update public.knowledge_index_items i set embedding=parsed,state=case when exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash) then 'ready' else 'obsolete' end,
   lease_id=null,lease_expires_at=null,last_error=null where i.id=row_id;
 end loop;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create function public.retry_knowledge_failures(p_owner uuid,p_generation uuid,p_confirm_unknown boolean) returns integer
language plpgsql security invoker set search_path='' as $$
declare count_items integer;
begin
 if p_confirm_unknown is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_RETRY_CONFIRMATION_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 for update;
 update public.knowledge_index_items set state='pending',last_error=null,lease_id=null,lease_expires_at=null where generation_id=p_generation
  and (state='failed' or (state='leased' and lease_expires_at<=clock_timestamp()));
 get diagnostics count_items=row_count;
 return count_items;
end $$;

create function public.match_knowledge(p_generation uuid,p_embedding extensions.vector,p_threshold double precision default -1,p_limit integer default 24,p_pins text[] default '{}')
returns table(item_id uuid,source_key text,target text,article_id bigint,chunk_type text,access text,content text,score double precision)
language sql stable security invoker set search_path='' as $$
 select i.id,s.source_key,s.target,s.article_id,s.chunk_type,s.access,i.content,
  1-(i.embedding operator(extensions.<=>) p_embedding) score
 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
 where i.generation_id=p_generation and i.state='ready' and extensions.vector_dims(p_embedding)=1024 and extensions.vector_norm(p_embedding)>0
  and p_threshold between -1 and 1 and cardinality(p_pins)<=3
  and 1-(i.embedding operator(extensions.<=>) p_embedding)>=p_threshold
 order by case when s.target=any(p_pins) then 0 else 1 end,i.embedding operator(extensions.<=>) p_embedding,i.id
 limit least(greatest(p_limit,1),24)
$$;

-- Evaluation is submitted by the service after bounded real-model holdout tests.
create function public.confirm_knowledge_evaluation(p_generation uuid,p_revision bigint,p_threshold double precision,p_evaluation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.knowledge_index_control where id=1 and source_revision=p_revision for update;
 if not found then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_threshold is null or p_threshold not between -1 and 1 or p_evaluation->>'passed' is distinct from 'true'
  or coalesce((p_evaluation->>'positiveCases')::integer,0)<20 or coalesce((p_evaluation->>'negativeCases')::integer,0)<20
  or coalesce((p_evaluation->>'holdoutRecall')::numeric,0)<0.9 or coalesce((p_evaluation->>'holdoutFalsePositives')::integer,-1)<>0
  or coalesce(p_evaluation->>'digest','') !~ '^[0-9a-f]{64}$' then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 if not exists(select 1 from public.knowledge_index_generations where id=p_generation and scan_complete and approved_revision=p_revision and state='building')
  or exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 update public.knowledge_index_generations set state='ready',threshold=p_threshold,evaluation=p_evaluation,evaluated_revision=p_revision where id=p_generation;
 return true;
end $$;
create function public.activate_knowledge_index(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'ready' or generation.evaluated_revision is distinct from epoch or not generation.scan_complete then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 if not exists(select 1 from public.ai_settings where id=1 and embedding_connection=generation.connection_id)
  or not exists(select 1 from public.ai_connections where id=generation.connection_id and verified_at is not null) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 update public.knowledge_index_generations set state='retired' where state='active';
 update public.knowledge_index_generations set state='active' where id=p_generation;
 update public.knowledge_index_control set active_generation=p_generation where id=1;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 40 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases) values(p_generation,epoch,case_digest,p_cases)
  on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

create function public.claim_knowledge_evaluation(p_run uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; run public.knowledge_evaluations; n integer;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into run from public.knowledge_evaluations where id=p_run for update;
 if not found or run.source_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_lease is null then raise exception 'KNOWLEDGE_LEASE_INVALID'; end if;
 if run.state='leased' and run.lease_expires_at<=clock_timestamp() then
  update public.knowledge_evaluations set state='failed',lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run;
  return jsonb_build_object('state','failed');
 end if;
 if run.state<>'pending' then return jsonb_build_object('state',run.state); end if;
 n:=least(16,jsonb_array_length(run.cases)-run.next_case);
 update public.knowledge_evaluations set state='leased',lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '90 seconds',leased_count=n,attempts=attempts+1 where id=p_run;
 return jsonb_build_object('state','leased','generationId',run.generation_id,'offset',run.next_case,
  'cases',(select jsonb_agg(value order by ordinality) from jsonb_array_elements(run.cases) with ordinality where ordinality>run.next_case and ordinality<=run.next_case+n));
end $$;

create function public.finish_knowledge_evaluation(p_run uuid,p_lease uuid,p_results jsonb,p_failed boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; run public.knowledge_evaluations;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into run from public.knowledge_evaluations where id=p_run for update;
 if not found or run.source_revision<>epoch or run.state<>'leased' or run.lease_id<>p_lease or run.lease_expires_at<=clock_timestamp() then return false; end if;
 if p_failed then
  update public.knowledge_evaluations set state='failed',lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run;
  return true;
 end if;
 if jsonb_typeof(p_results)<>'array' or jsonb_array_length(p_results)<>run.leased_count then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 update public.knowledge_evaluations set results=results||p_results,next_case=next_case+leased_count,
  state=case when next_case+leased_count=jsonb_array_length(cases) then 'complete' else 'pending' end,
  lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run;
 return true;
end $$;

create function public.retry_knowledge_evaluation(p_owner uuid,p_run uuid,p_confirm_unknown boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_confirm_unknown is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_RETRY_CONFIRMATION_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 for update;
 update public.knowledge_evaluations set state='pending',lease_id=null,lease_expires_at=null,leased_count=0 where id=p_run
  and (state='failed' or (state='leased' and lease_expires_at<=clock_timestamp()));
 return found;
end $$;

create function public.knowledge_index_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 with sources as materialized(select source_key,source_hash,octet_length(content) bytes from public.knowledge_sources),
 history as(select * from public.knowledge_index_generations order by (state in ('active','building','ready')) desc,created_at desc,id limit 20)
 select jsonb_build_object(
  'sourceRevision',(select source_revision from public.knowledge_index_control where id=1),
  'selectedConnection',(select embedding_connection from public.ai_settings where id=1),
  'activeGeneration',(select active_generation from public.knowledge_index_control where id=1),
  'sourceCount',(select count(*) from sources),'sourceBytes',coalesce((select sum(bytes) from sources),0),
  'generationCount',(select count(*) from public.knowledge_index_generations),
  'evaluations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'generationId',r.generation_id,'sourceRevision',r.source_revision,
    'state',case when r.state='leased' and r.lease_expires_at<=clock_timestamp() then 'failed' else r.state end,
    'completed',r.next_case,'total',jsonb_array_length(r.cases),'attempts',r.attempts))
    from public.knowledge_evaluations r where r.generation_id in (select id from history)),'[]'::jsonb),
  'generations',coalesce((select jsonb_agg(jsonb_build_object(
   'id',g.id,'connectionId',g.connection_id,'state',g.state,'scanCursor',g.scan_cursor,'scanComplete',g.scan_complete,
   'approvedRevision',g.approved_revision,'providerAttempts',g.provider_attempts,'threshold',g.threshold,
   'evaluation',g.evaluation,'evaluatedRevision',g.evaluated_revision,
   'counts',(select jsonb_build_object(
    'total',count(*) filter(where s.source_key is not null),
    'ready',count(*) filter(where s.source_key is not null and i.state='ready'),
    'pending',count(*) filter(where s.source_key is not null and i.state='pending'),
    'leased',count(*) filter(where s.source_key is not null and i.state='leased' and i.lease_expires_at>clock_timestamp()),
    'failed',count(*) filter(where s.source_key is not null and (i.state='failed' or (i.state='leased' and i.lease_expires_at<=clock_timestamp()))),
    'obsolete',count(*) filter(where s.source_key is null or i.state='obsolete'))
    from public.knowledge_index_items i left join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id)
  ) order by g.created_at desc,g.id) from history g),'[]'::jsonb))
$$;

create function public.discard_knowledge_generation(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 for update;
 if exists(select 1 from public.knowledge_index_generations where id=p_generation and state='active') then raise exception 'KNOWLEDGE_ACTIVE_DELETE_DENIED'; end if;
 delete from public.knowledge_index_generations where id=p_generation;
 return found;
end $$;

revoke all on function public.refresh_ai_public_state(),public.begin_knowledge_index(uuid,boolean,uuid,bigint,uuid),public.register_knowledge_source(uuid,text,text,jsonb),
 public.complete_knowledge_scan(uuid),public.claim_knowledge_batch(uuid,uuid),public.finish_knowledge_batch(uuid,uuid,jsonb,text),public.retry_knowledge_failures(uuid,uuid,boolean),
 public.knowledge_index_status(),public.discard_knowledge_generation(uuid,uuid),public.match_knowledge(uuid,extensions.vector,double precision,integer,text[]),public.confirm_knowledge_evaluation(uuid,bigint,double precision,jsonb),public.activate_knowledge_index(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.refresh_ai_public_state(),public.begin_knowledge_index(uuid,boolean,uuid,bigint,uuid),public.register_knowledge_source(uuid,text,text,jsonb),
 public.complete_knowledge_scan(uuid),public.claim_knowledge_batch(uuid,uuid),public.finish_knowledge_batch(uuid,uuid,jsonb,text),public.retry_knowledge_failures(uuid,uuid,boolean),
 public.knowledge_index_status(),public.discard_knowledge_generation(uuid,uuid),public.match_knowledge(uuid,extensions.vector,double precision,integer,text[]),public.confirm_knowledge_evaluation(uuid,bigint,double precision,jsonb),public.activate_knowledge_index(uuid,uuid) to service_role;
revoke all on function public.begin_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.claim_knowledge_evaluation(uuid,uuid),public.finish_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.retry_knowledge_evaluation(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.begin_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.claim_knowledge_evaluation(uuid,uuid),public.finish_knowledge_evaluation(uuid,uuid,jsonb,boolean),public.retry_knowledge_evaluation(uuid,uuid,boolean) to service_role;
update public.app_schema_version set version='20261020112058',applied_at=now() where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261021063700_knowledge_workflow_candidates.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

select id from public.knowledge_index_control where id=1 for update;
do $idle$ begin
 if exists(select 1 from public.knowledge_index_items where state='leased' and lease_expires_at>clock_timestamp())
  or exists(select 1 from public.knowledge_evaluations where state='leased' and lease_expires_at>clock_timestamp()) then
  raise exception 'KNOWLEDGE_UPGRADE_REQUIRES_IDLE_TASKS';
 end if;
end $idle$;

alter table public.knowledge_index_generations
 add column mode text not null default 'rebuild' check(mode in ('initialize','sync','rebuild')),
 add column base_generation uuid references public.knowledge_index_generations(id) on delete set null;

alter table public.knowledge_index_items add column reused boolean not null default false;

update public.knowledge_index_generations set mode='initialize'
 where state in ('building','ready') and not exists(select 1 from public.knowledge_index_control where active_generation is not null);

create or replace function public.begin_knowledge_index(p_owner uuid,p_consent boolean,p_generation uuid default null,p_expected_revision bigint default null,p_expected_connection uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare epoch bigint; selected_connection uuid; result_id uuid;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_consent is distinct from true then raise exception 'KNOWLEDGE_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 if p_expected_revision is not null and p_expected_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if p_generation is not null then
  if not exists(select 1 from public.knowledge_index_generations g join public.ai_settings s on s.embedding_connection=g.connection_id where g.id=p_generation and s.id=1 and (p_expected_connection is null or g.connection_id=p_expected_connection)) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
  if exists(select 1 from public.knowledge_index_generations where id=p_generation and state='failed')
   and exists(select 1 from public.knowledge_index_generations where id<>p_generation and state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
  update public.knowledge_index_generations set approved_revision=epoch,state=case when state='failed' then 'building' else state end
   where id=p_generation and state in ('building','failed') returning id into result_id;
  if result_id is null then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
  return result_id;
 end if;
 select s.embedding_connection into selected_connection from public.ai_settings s join public.ai_connections c on c.id=s.embedding_connection
  where s.id=1 and c.verified_at is not null;
 if selected_connection is null then raise exception 'KNOWLEDGE_CONNECTION_UNVERIFIED'; end if;
 if p_expected_connection is not null and selected_connection<>p_expected_connection then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 if not exists(select 1 from public.knowledge_sources) then raise exception 'KNOWLEDGE_EMPTY'; end if;
 if exists(select 1 from public.knowledge_index_generations where state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
 insert into public.knowledge_index_generations(connection_id,created_by,approved_revision) values(selected_connection,p_owner,epoch) returning id into result_id;
 return result_id;
end $$;

create or replace function public.register_knowledge_source(p_generation uuid,p_source text,p_hash text,p_parts jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations; source public.knowledge_sources; v_part jsonb; position_char integer:=0; n integer:=0; expected text;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'building' then raise exception 'KNOWLEDGE_GENERATION_UNAVAILABLE'; end if;
 if generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 select * into source from public.knowledge_sources where source_key=p_source;
 if not found or source.source_hash is distinct from p_hash then return false; end if;
 if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts) not between 1 and 4096 then raise exception 'KNOWLEDGE_PARTS_INVALID'; end if;
 for v_part in select value from jsonb_array_elements(p_parts) loop
  if (v_part->>'start')::integer is distinct from position_char or (v_part->>'end')::integer<=position_char then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
  expected:=substring(source.content from position_char+1 for (v_part->>'end')::integer-position_char);
  if v_part->>'content' is distinct from expected or octet_length(expected) not between 1 and 2048 then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
  insert into public.knowledge_index_items(generation_id,source_key,source_hash,part,start_char,end_char,content)
   values(p_generation,p_source,p_hash,n,position_char,(v_part->>'end')::integer,expected) on conflict(generation_id,source_key,source_hash,part) do update
    set state=case when knowledge_index_items.state='obsolete' then case when knowledge_index_items.embedding is null then 'pending' else 'ready' end else knowledge_index_items.state end;
  position_char:=(v_part->>'end')::integer;n:=n+1;
 end loop;
 if position_char<>length(source.content) then raise exception 'KNOWLEDGE_COVERAGE_INVALID'; end if;
 update public.knowledge_index_items set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation and source_key=p_source and source_hash<>p_hash;
 update public.knowledge_index_generations set scan_cursor=greatest(scan_cursor,p_source) where id=p_generation;
 -- Only copy vectors after the new source coverage has been validated. Permission
 -- and source revision remain authoritative; no evaluation/lease is inherited.
 if generation.base_generation is not null then
  update public.knowledge_index_items dst set embedding=src.embedding,state='ready',reused=true
  from public.knowledge_index_items src, public.knowledge_index_generations base
  where dst.generation_id=p_generation and dst.source_key=p_source and dst.source_hash=p_hash and dst.state='pending'
   and base.id=generation.base_generation and base.connection_id=generation.connection_id and base.preprocessing=generation.preprocessing
   and src.generation_id=base.id and src.source_key=dst.source_key and src.source_hash=dst.source_hash
   and src.part=dst.part and src.start_char=dst.start_char and src.end_char=dst.end_char and src.content=dst.content
   and src.state='ready' and src.embedding is not null;
 end if;
 return true;
end $$;

create or replace function public.complete_knowledge_scan(p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'building' or generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if exists(select 1 from public.knowledge_sources where source_key>generation.scan_cursor) then return false; end if;
 update public.knowledge_index_generations set scan_complete=true where id=p_generation;
 update public.knowledge_index_items i set state='obsolete',lease_id=null,lease_expires_at=null where generation_id=p_generation
  and not exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash);
 return true;
end $$;

create or replace function public.claim_knowledge_batch(p_generation uuid,p_lease uuid)
returns table(item_id uuid,content text) language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if p_lease is null then raise exception 'KNOWLEDGE_LEASE_INVALID'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'building' or not generation.scan_complete then raise exception 'KNOWLEDGE_SCAN_REQUIRED'; end if;
 if generation.approved_revision<>epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 update public.knowledge_index_items set state='failed',last_error='LEASE_EXPIRED_UNKNOWN',lease_id=null,lease_expires_at=null
  where generation_id=p_generation and state='leased' and lease_expires_at<=clock_timestamp();
 if exists(select 1 from public.knowledge_index_items where generation_id=p_generation and state='failed') then return; end if;
 return query with selected as (
  select i.id from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
  where i.generation_id=p_generation and i.state='pending' order by i.id for update of i skip locked limit 16
 ), changed as (
  update public.knowledge_index_items i set state='leased',lease_id=p_lease,lease_expires_at=clock_timestamp()+interval '90 seconds',attempts=attempts+1
  from selected where i.id=selected.id returning i.id,i.content
 ) select id,changed.content from changed;
 if found then update public.knowledge_index_generations set provider_attempts=provider_attempts+1 where id=p_generation; end if;
end $$;

create or replace function public.finish_knowledge_batch(p_generation uuid,p_lease uuid,p_vectors jsonb,p_error text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare leased integer; item jsonb; row_id uuid; parsed extensions.vector(1024);
begin
 perform 1 from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' for update;
 if not found then return false; end if;
 select count(*) into leased from public.knowledge_index_items where generation_id=p_generation and state='leased' and lease_id=p_lease and lease_expires_at>clock_timestamp();
 if leased=0 then return false; end if;
 if p_error is not null then
  if p_error !~ '^[A-Z0-9_]{1,80}$' then raise exception 'KNOWLEDGE_ERROR_INVALID'; end if;
  update public.knowledge_index_items set state='failed',last_error=p_error,lease_id=null,lease_expires_at=null where generation_id=p_generation and state='leased' and lease_id=p_lease;
  return true;
 end if;
 if jsonb_typeof(p_vectors)<>'array' or jsonb_array_length(p_vectors)<>leased
  or (select count(distinct value->>'id') from jsonb_array_elements(p_vectors))<>leased then raise exception 'KNOWLEDGE_VECTOR_COUNT_INVALID'; end if;
 for item in select value from jsonb_array_elements(p_vectors) loop
  row_id:=(item->>'id')::uuid; parsed:=(item->>'vector')::extensions.vector(1024);
  if parsed is null or extensions.vector_norm(parsed)<=0 then raise exception 'KNOWLEDGE_VECTOR_INVALID'; end if;
  if not exists(select 1 from public.knowledge_index_items where id=row_id and generation_id=p_generation and state='leased' and lease_id=p_lease and lease_expires_at>clock_timestamp()) then raise exception 'KNOWLEDGE_LEASE_LOST'; end if;
  update public.knowledge_index_items i set embedding=parsed,state=case when exists(select 1 from public.knowledge_sources s where s.source_key=i.source_key and s.source_hash=i.source_hash) then 'ready' else 'obsolete' end,
   lease_id=null,lease_expires_at=null,last_error=null where i.id=row_id;
 end loop;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create or replace function public.knowledge_index_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 with sources as materialized(select source_key,source_hash,octet_length(content) bytes from public.knowledge_sources),
 history as(select * from public.knowledge_index_generations order by (state in ('active','building','ready')) desc,created_at desc,id limit 20)
 select jsonb_build_object(
  'sourceRevision',(select source_revision from public.knowledge_index_control where id=1),
  'selectedConnection',(select embedding_connection from public.ai_settings where id=1),
  'activeGeneration',(select active_generation from public.knowledge_index_control where id=1),
  'sourceCount',(select count(*) from sources),'sourceBytes',coalesce((select sum(bytes) from sources),0),
  'generationCount',(select count(*) from public.knowledge_index_generations),
  'evaluations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'generationId',r.generation_id,'sourceRevision',r.source_revision,
    'state',case when r.state='leased' and r.lease_expires_at<=clock_timestamp() then 'failed' else r.state end,
    'completed',r.next_case,'total',jsonb_array_length(r.cases),'attempts',r.attempts))
    from public.knowledge_evaluations r where r.generation_id in (select id from history)),'[]'::jsonb),
  'generations',coalesce((select jsonb_agg(jsonb_build_object(
   'mode',g.mode,'baseGeneration',g.base_generation,'reusedItems',(select count(*) from public.knowledge_index_items i join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id and i.reused and i.state='ready'),'id',g.id,'connectionId',g.connection_id,'state',g.state,'scanCursor',g.scan_cursor,'scanComplete',g.scan_complete,
   'approvedRevision',g.approved_revision,'providerAttempts',g.provider_attempts,'threshold',g.threshold,
   'evaluation',g.evaluation,'evaluatedRevision',g.evaluated_revision,
   'counts',(select jsonb_build_object(
    'total',count(*) filter(where s.source_key is not null),
    'ready',count(*) filter(where s.source_key is not null and i.state='ready'),
    'pending',count(*) filter(where s.source_key is not null and i.state='pending'),
    'leased',count(*) filter(where s.source_key is not null and i.state='leased' and i.lease_expires_at>clock_timestamp()),
    'failed',count(*) filter(where s.source_key is not null and (i.state='failed' or (i.state='leased' and i.lease_expires_at<=clock_timestamp()))),
    'obsolete',count(*) filter(where s.source_key is null or i.state='obsolete'))
    from public.knowledge_index_items i left join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id)
  ) order by g.created_at desc,g.id) from history g),'[]'::jsonb))
$$;
create function public.start_knowledge_task(p_owner uuid,p_mode text,p_consent boolean,p_revision bigint,p_connection uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare active public.knowledge_index_generations; result_id uuid; epoch bigint;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_consent is distinct from true then raise exception 'KNOWLEDGE_CONSENT_REQUIRED'; end if;
 if p_mode not in ('initialize','sync','rebuild') or p_mode is null then raise exception 'KNOWLEDGE_MODE_INVALID'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 if p_revision is distinct from epoch then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if not exists(select 1 from public.ai_settings s join public.ai_connections c on c.id=s.embedding_connection
  where s.id=1 and s.embedding_connection=p_connection and c.verified_at is not null) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 select g.* into active from public.knowledge_index_control c join public.knowledge_index_generations g on g.id=c.active_generation where c.id=1;
 if p_mode='initialize' and active.id is not null then raise exception 'KNOWLEDGE_ALREADY_INITIALIZED'; end if;
 if p_mode='sync' then
  if active.id is null then raise exception 'KNOWLEDGE_INITIALIZE_REQUIRED'; end if;
  if active.connection_id<>p_connection or active.preprocessing<>'utf8-paragraph-v1' then raise exception 'KNOWLEDGE_REBUILD_REQUIRED'; end if;
  if exists(select 1 from public.knowledge_index_generations where state in ('building','ready')) then raise exception 'KNOWLEDGE_BUILD_EXISTS'; end if;
  if active.scan_complete and active.approved_revision=epoch
   and not exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i
    where i.generation_id=active.id and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then return active.id; end if;
 end if;
 result_id:=public.begin_knowledge_index(p_owner,true,null,epoch,p_connection);
 update public.knowledge_index_generations set mode=p_mode,base_generation=case when p_mode='sync' then active.id else null end where id=result_id;
 return result_id;
end $$;

-- Metadata-only source chooser. A literal substring search never treats user text
-- as SQL/ILIKE syntax and never returns source bodies or private conversations.
create function public.knowledge_source_choices(p_query text default '')
returns table(target text,title text) language sql stable security invoker set search_path='' as $$
 with choices as (
  select distinct s.target,coalesce(a.title,left(q.question_md,100),'公开问答') title
  from public.knowledge_sources s left join public.articles a on a.id=s.article_id
  left join public.conversation_publications q on s.source_key='qa:'||q.conversation_id
 )
 select c.target,c.title from choices c
 where length(coalesce(p_query,''))<=120 and (c.title ilike '%'||replace(replace(replace(coalesce(p_query,''),'\','\\'),'%','\%'),'_','\_')||'%'
  or c.target ilike '%'||replace(replace(replace(coalesce(p_query,''),'\','\\'),'%','\%'),'_','\_')||'%')
 order by c.title,c.target limit 30
$$;

create function public.knowledge_evaluation_sources_valid(p_targets text[])
returns boolean language sql stable security invoker set search_path='' as $$
 select cardinality(p_targets)<=300 and not exists(select 1 from unnest(p_targets) as expected(target)
  where not exists(select 1 from public.knowledge_sources s where s.target=expected.target))
$$;

create or replace function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 40 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if not public.knowledge_evaluation_sources_valid(array(select distinct jsonb_array_elements_text(value->'expected') from jsonb_array_elements(p_cases))) then raise exception 'KNOWLEDGE_EVALUATION_SOURCE_MISSING'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases) values(p_generation,epoch,case_digest,p_cases)
  on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

revoke all on function public.start_knowledge_task(uuid,text,boolean,bigint,uuid),public.knowledge_source_choices(text),public.knowledge_evaluation_sources_valid(text[]) from public,anon,authenticated;
grant execute on function public.start_knowledge_task(uuid,text,boolean,bigint,uuid),public.knowledge_source_choices(text),public.knowledge_evaluation_sources_valid(text[]) to service_role;

update public.app_schema_version set version='20261021063700' where id=1;

-- Source migration: 20261022065829_knowledge_preview_workflow.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.knowledge_evaluations drop constraint knowledge_evaluations_cases_check;
alter table public.knowledge_evaluations add constraint knowledge_evaluations_cases_check check(jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 20 and 100);
alter table public.knowledge_evaluations add column policy_version integer not null default 1 check(policy_version in (1,2));
alter table public.knowledge_evaluations add column fixed_threshold double precision check(fixed_threshold between -1 and 1);
alter table public.knowledge_evaluations add column regression_from uuid references public.knowledge_evaluations(id) on delete set null;
alter table public.knowledge_index_generations add column accepted_run uuid references public.knowledge_evaluations(id) on delete set null;
alter table public.knowledge_index_generations add column accepted_by uuid references auth.users(id);
alter table public.knowledge_index_generations add column accepted_at timestamptz;
alter table public.knowledge_index_generations add column accepted_policy_version integer check(accepted_policy_version=2);
alter table public.ai_calls drop constraint ai_calls_task_check;
alter table public.ai_calls add constraint ai_calls_task_check check(task in ('avatar','page','generation_probe','embedding_probe','retrieval','knowledge_questions','knowledge_preview','knowledge_preview_retrieval'));

create table public.knowledge_question_drafts (
 id uuid primary key,
 generation_id uuid not null references public.knowledge_index_generations(id) on delete cascade,
 source_revision bigint not null,
 connection_id uuid not null references public.ai_connections(id),
 state text not null default 'pending' check(state in ('pending','leased','failed','complete')),
 manifest jsonb not null check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 10),
 next_item integer not null default 0 check(next_item between 0 and 10),
 cases jsonb not null default '[]' check(jsonb_typeof(cases)='array' and octet_length(cases::text)<=100000),
 lease_id uuid,
 lease_expires_at timestamptz,
 created_at timestamptz not null default now(),
 unique(generation_id,source_revision,connection_id),
 check((state='leased')=(lease_id is not null and lease_expires_at is not null))
);
create index knowledge_question_drafts_generation on public.knowledge_question_drafts(generation_id,created_at desc,id);
alter table public.knowledge_question_drafts enable row level security;
revoke all on public.knowledge_question_drafts from public,anon,authenticated;
grant select,insert,update,delete on public.knowledge_question_drafts to service_role;

create or replace function public.reserve_ai_call(p_request uuid,p_task text,p_connection uuid,p_user uuid,p_ip text)
returns text language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; old_call public.ai_calls; owner_user boolean; cap integer; v_now timestamptz; start_day timestamptz;
begin
 if p_request is null or p_task is null or p_task not in ('avatar','page','generation_probe','embedding_probe','retrieval','knowledge_questions','knowledge_preview','knowledge_preview_retrieval')
  or p_connection is null or length(coalesce(p_ip,''))>128 or (p_user is null and nullif(p_ip,'') is null) then raise exception 'INVALID_AI_CALL'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'AI_BUDGET_REQUIRES_READ_COMMITTED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-call-budget',0));
 v_now:=clock_timestamp();start_day:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 select * into old_call from public.ai_calls where request_id=p_request;
 if found then
  if old_call.task is distinct from p_task or old_call.connection_id is distinct from p_connection
   or old_call.user_id is distinct from p_user or old_call.ip is distinct from p_ip then raise exception 'AI_CALL_MISMATCH'; end if;
  return 'duplicate';
 end if;
 select * into cfg from public.ai_settings where id=1;
 if p_user is not null then
  select is_owner into owner_user from public.profiles where id=p_user;
  if not found then raise exception 'INVALID_AI_PRINCIPAL'; end if;
 else owner_user:=false; end if;
 if p_task in ('page','generation_probe','embedding_probe','knowledge_questions','knowledge_preview','knowledge_preview_retrieval') and not owner_user then raise exception 'OWNER_REQUIRED'; end if;
 if p_task in ('avatar','retrieval') and (not cfg.avatar_enabled or
  not exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true') or (p_user is null and not cfg.anonymous_entry)) then return 'disabled'; end if;
 if p_task in ('page','avatar','generation_probe','knowledge_questions','knowledge_preview') and p_connection is distinct from cfg.generation_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task in ('embedding_probe','knowledge_preview_retrieval') and p_connection is distinct from cfg.embedding_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task not in ('generation_probe','embedding_probe') and not exists(select 1 from public.ai_connections where id=p_connection and verified_at is not null) then return 'unverified'; end if;
 cap:=case when p_task in ('generation_probe','embedding_probe') then 20 when p_task in ('page','knowledge_questions','knowledge_preview','knowledge_preview_retrieval') then 60
  when p_task='retrieval' then case when p_user is null then 15 else 300 end
  when p_user is null then 5
  when exists(select 1 from public.entitlements where user_id=p_user and revoked_at is null and type='subscription'
    and starts_at<=v_now and (ends_at is null or ends_at>v_now)) then 100 else 20 end;
 if (not owner_user or p_task<>'avatar') and ((select count(*) from public.ai_calls where created_at>=start_day and task=p_task
   and state<>'released' and (state<>'reserved' or expires_at>v_now)
   and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) +
   case when p_task='avatar' then (select count(*) from public.avatar_usage where created_at>=start_day and generation_state<>'released'
    and (generation_state<>'reserved' or reservation_expires_at>v_now)
    and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) else 0 end)>=cap then return 'daily_limit'; end if;
 if (select count(*) from public.ai_calls where created_at>v_now-interval '1 minute' and task=p_task
   and state<>'released' and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end)>=5 then return 'rate_limit'; end if;
 if p_task in ('avatar','page','knowledge_questions','knowledge_preview') and cfg.monthly_limit is not null and (
  (select count(*) from public.ai_calls where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and task in ('avatar','page','knowledge_questions','knowledge_preview') and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now)))>=cfg.monthly_limit then return 'monthly_limit'; end if;
 insert into public.ai_calls(request_id,task,connection_id,user_id,ip,state,expires_at,created_at)
 values(p_request,p_task,p_connection,p_user,p_ip,'reserved',v_now+interval '60 seconds',v_now);
 return 'reserved';
end $$;

create or replace function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state='building' and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 20 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if not public.knowledge_evaluation_sources_valid(array(select distinct jsonb_array_elements_text(value->'expected') from jsonb_array_elements(p_cases))) then raise exception 'KNOWLEDGE_EVALUATION_SOURCE_MISSING'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases,policy_version,fixed_threshold,regression_from)
 select p_generation,epoch,case_digest,p_cases,2,
  case when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing and b.accepted_policy_version=2
    and b.accepted_run=r.id and (select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(r.cases) with ordinality)=(select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(p_cases) with ordinality) then b.threshold end,
  case when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing and b.accepted_policy_version=2
    and b.accepted_run=r.id and (select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(r.cases) with ordinality)=(select jsonb_agg(jsonb_build_object('question',value->'question','expected',value->'expected') order by ordinality) from jsonb_array_elements(p_cases) with ordinality) then r.id end
 from public.knowledge_index_generations g left join public.knowledge_index_generations b on b.id=g.base_generation
 left join public.knowledge_evaluations r on r.id=b.accepted_run where g.id=p_generation
  on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

create or replace function public.confirm_knowledge_evaluation(p_generation uuid,p_revision bigint,p_threshold double precision,p_evaluation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare run public.knowledge_evaluations; positives integer; negatives integer;
begin
 perform 1 from public.knowledge_index_control where id=1 and source_revision=p_revision for update;
 if not found then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 if not exists(select 1 from public.knowledge_index_generations where id=p_generation and scan_complete and approved_revision=p_revision and state in ('building','ready'))
  or exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 select * into run from public.knowledge_evaluations where generation_id=p_generation and source_revision=p_revision
  and digest=p_evaluation->>'digest' and state='complete';
 if not found or jsonb_array_length(run.results)<>jsonb_array_length(run.cases) then raise exception 'KNOWLEDGE_EVALUATION_INCOMPLETE'; end if;
 select count(*) filter(where jsonb_array_length(value->'expected')>0),count(*) filter(where jsonb_array_length(value->'expected')=0)
 into positives,negatives from jsonb_array_elements(run.cases);
 if p_threshold is null or p_threshold not between -1 and 1 or p_evaluation->>'passed' is distinct from 'true'
  or p_evaluation->>'policyVersion' is distinct from '2' or positives<10 or negatives<10
  or (p_evaluation->>'positiveCases')::integer is distinct from positives or (p_evaluation->>'negativeCases')::integer is distinct from negatives
  or coalesce((p_evaluation->>'hits')::integer,0)<ceil(positives*.8) or (p_evaluation->>'hits')::integer>positives
  or coalesce((p_evaluation->>'recall')::numeric,0)<.8
  or abs((p_evaluation->>'recall')::numeric-(p_evaluation->>'hits')::numeric/positives)>0.000000001
  or coalesce((p_evaluation->>'falsePositives')::integer,-1) not between 0 and negatives
 then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 update public.knowledge_index_generations set state='ready',threshold=p_threshold,evaluation=p_evaluation,evaluated_revision=p_revision,
  accepted_at=case when accepted_run=run.id then accepted_at end,
  accepted_policy_version=case when accepted_run=run.id then accepted_policy_version end,
  accepted_by=case when accepted_run=run.id then accepted_by end,
  accepted_run=case when accepted_run=run.id then accepted_run end where id=p_generation;
 return true;
end $$;

create function public.accept_knowledge_preview(p_owner uuid,p_run uuid,p_accept_warnings boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare run public.knowledge_evaluations; g public.knowledge_index_generations; epoch bigint;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into run from public.knowledge_evaluations where id=p_run and state='complete' and source_revision=epoch;
 if not found then raise exception 'KNOWLEDGE_EVALUATION_INCOMPLETE'; end if;
 select * into g from public.knowledge_index_generations where id=run.generation_id for update;
 if not found or g.state<>'ready' or g.evaluated_revision is distinct from epoch or g.evaluation->>'digest' is distinct from run.digest
  or g.evaluation->>'policyVersion' is distinct from '2' or p_accept_warnings is distinct from true then raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end if;
 update public.knowledge_index_generations set accepted_run=run.id,accepted_by=p_owner,accepted_at=clock_timestamp(),accepted_policy_version=2 where id=g.id;
 return true;
end $$;
revoke all on function public.accept_knowledge_preview(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.accept_knowledge_preview(uuid,uuid,boolean) to service_role;

create or replace function public.activate_knowledge_index(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state<>'ready' or generation.accepted_at is null or generation.accepted_by is distinct from p_owner or generation.accepted_run is null or generation.evaluated_revision is distinct from epoch or not generation.scan_complete then raise exception 'KNOWLEDGE_EVALUATION_REQUIRED'; end if;
 if not exists(select 1 from public.ai_settings where id=1 and embedding_connection=generation.connection_id)
  or not exists(select 1 from public.ai_connections where id=generation.connection_id and verified_at is not null) then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 update public.knowledge_index_generations set state='retired' where state='active';
 update public.knowledge_index_generations set state='active' where id=p_generation;
 update public.knowledge_index_control set active_generation=p_generation where id=1;
 perform public.refresh_ai_public_state();
 return true;
end $$;

create or replace function public.knowledge_index_status() returns jsonb
language sql stable security invoker set search_path='' as $$
 with sources as materialized(select source_key,source_hash,octet_length(content) bytes from public.knowledge_sources),
 history as(select * from public.knowledge_index_generations order by (state in ('active','building','ready')) desc,created_at desc,id limit 20)
 select jsonb_build_object(
  'sourceRevision',(select source_revision from public.knowledge_index_control where id=1),
  'selectedConnection',(select embedding_connection from public.ai_settings where id=1),
  'activeGeneration',(select active_generation from public.knowledge_index_control where id=1),
  'sourceCount',(select count(*) from sources),'sourceBytes',coalesce((select sum(bytes) from sources),0),
  'generationCount',(select count(*) from public.knowledge_index_generations),
  'evaluations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'generationId',r.generation_id,'sourceRevision',r.source_revision,
    'state',case when r.state='leased' and r.lease_expires_at<=clock_timestamp() then 'failed' else r.state end,
    'completed',r.next_case,'total',jsonb_array_length(r.cases),'attempts',r.attempts))
    from public.knowledge_evaluations r where r.generation_id in (select id from history)),'[]'::jsonb),
  'generations',coalesce((select jsonb_agg(jsonb_build_object(
   'mode',g.mode,'baseGeneration',g.base_generation,'reusedItems',(select count(*) from public.knowledge_index_items i join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id and i.reused and i.state='ready'),'id',g.id,'connectionId',g.connection_id,'state',g.state,'scanCursor',g.scan_cursor,'scanComplete',g.scan_complete,
   'approvedRevision',g.approved_revision,'providerAttempts',g.provider_attempts,'threshold',g.threshold,
   'acceptedRun',g.accepted_run,'evaluation',g.evaluation,'evaluatedRevision',g.evaluated_revision,
   'counts',(select jsonb_build_object(
    'total',count(*) filter(where s.source_key is not null),
    'ready',count(*) filter(where s.source_key is not null and i.state='ready'),
    'pending',count(*) filter(where s.source_key is not null and i.state='pending'),
    'leased',count(*) filter(where s.source_key is not null and i.state='leased' and i.lease_expires_at>clock_timestamp()),
    'failed',count(*) filter(where s.source_key is not null and (i.state='failed' or (i.state='leased' and i.lease_expires_at<=clock_timestamp()))),
    'obsolete',count(*) filter(where s.source_key is null or i.state='obsolete'))
    from public.knowledge_index_items i left join sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=g.id)
  ) order by g.created_at desc,g.id) from history g),'[]'::jsonb))
$$;

create function public.knowledge_question_manifest(p_generation uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with candidates as (
  select i.id,s.target,coalesce(a.title,'站内公开问答') title,octet_length(i.content) bytes,i.source_key,i.source_hash,
   row_number() over(partition by s.target order by case when s.chunk_type in ('body','qa') then 0 else 1 end,i.source_key,i.part,i.id) rn
  from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash
  left join public.articles a on a.id=s.article_id
  where i.generation_id=p_generation and i.state='ready'
 ), sample as (select * from candidates order by rn,target,id limit 10)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'target',target,'title',title,'bytes',bytes,'sourceKey',source_key,'sourceHash',source_hash) order by rn,target,id),'[]'::jsonb) from sample
$$;
revoke all on function public.knowledge_question_manifest(uuid) from public,anon,authenticated;
grant execute on function public.knowledge_question_manifest(uuid) to service_role;

create or replace function public.dispatch_ai_call(p_request uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 update public.ai_calls set state='dispatched' where request_id=p_request and state='reserved' and expires_at>clock_timestamp()
  and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'
  and exists(select 1 from public.ai_settings s where s.id=1 and
   case when task in ('avatar','page','generation_probe','knowledge_questions','knowledge_preview') then s.generation_connection=connection_id
    when task in ('embedding_probe','knowledge_preview_retrieval') then s.embedding_connection=connection_id else true end
   and (task not in ('avatar','retrieval') or (s.avatar_enabled and (user_id is not null or s.anonymous_entry)
    and exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true'))))
  returning request_id into changed;
 return changed is not null;
end $$;

create function public.knowledge_missing_sources(p_targets text[]) returns text[]
language plpgsql stable security invoker set search_path='' as $$
begin
 if cardinality(p_targets)>300 then raise exception 'KNOWLEDGE_EVALUATION_CASE_INVALID'; end if;
 return array(select distinct target from unnest(p_targets) t(target) where not exists(select 1 from public.knowledge_sources s where s.target=t.target) order by target);
end $$;
revoke all on function public.knowledge_missing_sources(text[]) from public,anon,authenticated;
grant execute on function public.knowledge_missing_sources(text[]) to service_role;

update public.app_schema_version set version='20261022065829' where id=1;

-- Source migration: 20261023112358_knowledge_owner_activation.sql

set local lock_timeout='5s';
set local statement_timeout='30s';

alter table public.knowledge_evaluations drop constraint knowledge_evaluations_cases_check;
alter table public.knowledge_evaluations add constraint knowledge_evaluations_cases_check check(jsonb_typeof(cases)='array' and jsonb_array_length(cases) between 1 and 100);
alter table public.knowledge_evaluations drop constraint knowledge_evaluations_policy_version_check;
alter table public.knowledge_evaluations add constraint knowledge_evaluations_policy_version_check check(policy_version in (1,2,3));
alter table public.knowledge_index_generations drop constraint knowledge_index_generations_accepted_policy_version_check;
alter table public.knowledge_index_generations add constraint knowledge_index_generations_accepted_policy_version_check check(accepted_policy_version in (2,3));

alter table public.knowledge_index_generations add column accepted_revision bigint;

-- A stable retrieval policy, independent of editable diagnostic questions.
-- Compatible incremental updates keep the serving cutoff; new mechanisms use 0.5.
create function public.knowledge_runtime_threshold(p_generation uuid) returns double precision
language sql stable security invoker set search_path='' as $$
 select coalesce(case when g.state='active' then g.threshold
  when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing then b.threshold end,0.5)
 from public.knowledge_index_generations g left join public.knowledge_index_generations b on b.id=g.base_generation where g.id=p_generation
$$;
revoke all on function public.knowledge_runtime_threshold(uuid) from public,anon,authenticated;
grant execute on function public.knowledge_runtime_threshold(uuid) to service_role;

create or replace function public.begin_knowledge_evaluation(p_owner uuid,p_generation uuid,p_cases jsonb,p_consent boolean) returns uuid
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; case_digest text; result_id uuid;
begin
 if p_consent is distinct from true or not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'KNOWLEDGE_EVALUATION_CONSENT_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 perform 1 from public.knowledge_index_generations where id=p_generation and state in ('building','ready','active') and scan_complete and approved_revision=epoch for update;
 if not found then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if p_cases is null or jsonb_typeof(p_cases)<>'array' or jsonb_array_length(p_cases) not between 1 and 100 or octet_length(p_cases::text)>180000 then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_cases) c where jsonb_typeof(c->'question') is distinct from 'string' or length(btrim(c->>'question'))=0 or octet_length(c->>'question')>1024
  or c->>'reviewed'='false' or jsonb_typeof(c->'expected') is distinct from 'array') then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_cases) c where jsonb_array_length(c->'expected')>3)
  or exists(select 1 from jsonb_array_elements(p_cases) c cross join lateral jsonb_array_elements_text(c->'expected') t(target) where target !~ '^(article:[a-z0-9-]{1,120}|qa:[0-9]{1,20})$')
  or (select count(distinct lower(regexp_replace(btrim(c->>'question'),'\s+',' ','g'))) from jsonb_array_elements(p_cases) c)<>jsonb_array_length(p_cases) then raise exception 'KNOWLEDGE_EVALUATION_INVALID'; end if;
 if exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where generation_id=p_generation and i.state<>'ready')
  or not exists(select 1 from public.knowledge_sources)
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 if not public.knowledge_evaluation_sources_valid(array(select distinct jsonb_array_elements_text(value->'expected') from jsonb_array_elements(p_cases))) then raise exception 'KNOWLEDGE_EVALUATION_SOURCE_MISSING'; end if;
 case_digest:=encode(sha256(convert_to(p_cases::text,'UTF8')),'hex');
 insert into public.knowledge_evaluations(generation_id,source_revision,digest,cases,policy_version,fixed_threshold,regression_from)
 select p_generation,epoch,case_digest,p_cases,3,public.knowledge_runtime_threshold(g.id),
  case when g.mode='sync' and b.connection_id=g.connection_id and b.preprocessing=g.preprocessing then b.accepted_run end
 from public.knowledge_index_generations g left join public.knowledge_index_generations b on b.id=g.base_generation where g.id=p_generation
 on conflict(generation_id,source_revision,digest) do update set digest=excluded.digest returning id into result_id;
 return result_id;
end $$;

-- Retain old signatures for safe failures during an application rollout.
create or replace function public.confirm_knowledge_evaluation(p_generation uuid,p_revision bigint,p_threshold double precision,p_evaluation jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin raise exception 'KNOWLEDGE_DIAGNOSTIC_ONLY'; end $$;
create or replace function public.accept_knowledge_preview(p_owner uuid,p_run uuid,p_accept_warnings boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end $$;

create or replace function public.activate_knowledge_index(p_owner uuid,p_generation uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare epoch bigint; generation public.knowledge_index_generations;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select source_revision into epoch from public.knowledge_index_control where id=1 for update;
 select * into generation from public.knowledge_index_generations where id=p_generation for update;
 if not found or generation.state not in ('building','ready','active') or generation.accepted_at is null
  or generation.accepted_by is distinct from p_owner or generation.accepted_policy_version is distinct from 3 or generation.accepted_revision is distinct from epoch then raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end if;
 if generation.approved_revision is distinct from epoch or not generation.scan_complete
  or not exists(select 1 from public.knowledge_sources)
  or exists(select 1 from public.knowledge_index_items i join public.knowledge_sources s on s.source_key=i.source_key and s.source_hash=i.source_hash where i.generation_id=p_generation and i.state<>'ready')
  or exists(select 1 from public.knowledge_sources s where not exists(select 1 from public.knowledge_index_items i where i.generation_id=p_generation and i.source_key=s.source_key and i.source_hash=s.source_hash and i.state='ready')) then raise exception 'KNOWLEDGE_INCOMPLETE'; end if;
 perform 1 from public.ai_settings where id=1 and embedding_connection=generation.connection_id for update;
 if not found then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 perform 1 from public.ai_connections where id=generation.connection_id and verified_at is not null for share;
 if not found then raise exception 'KNOWLEDGE_CONNECTION_UNVERIFIED'; end if;
 update public.knowledge_index_generations set state='retired' where state='active' and id<>p_generation;
 update public.knowledge_index_generations set state='active',threshold=public.knowledge_runtime_threshold(p_generation) where id=p_generation;
 update public.knowledge_index_control set active_generation=p_generation where id=1;
 perform public.refresh_ai_public_state();
 return true;
end $$;

-- Confirmation and switching are atomic. Neither a report nor its score grants authority.
create function public.enable_knowledge_index(p_owner uuid,p_generation uuid,p_revision bigint,p_connection uuid,p_confirm boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 if p_confirm is distinct from true then raise exception 'KNOWLEDGE_ACCEPTANCE_REQUIRED'; end if;
 perform 1 from public.knowledge_index_control where id=1 and source_revision=p_revision for update;
 if not found then raise exception 'KNOWLEDGE_SOURCE_CHANGED'; end if;
 perform 1 from public.knowledge_index_generations where id=p_generation and connection_id=p_connection and state in ('building','ready','active') for update;
 if not found then raise exception 'KNOWLEDGE_CONNECTION_CHANGED'; end if;
 update public.knowledge_index_generations set accepted_by=p_owner,accepted_at=clock_timestamp(),accepted_policy_version=3,accepted_revision=p_revision where id=p_generation;
 return public.activate_knowledge_index(p_owner,p_generation);
end $$;
revoke all on function public.enable_knowledge_index(uuid,uuid,bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.enable_knowledge_index(uuid,uuid,bigint,uuid,boolean) to service_role;

update public.app_schema_version set version='20261023112358' where id=1;

-- Source migration: 20261024020015_independent_skills_foundation.sql

set local lock_timeout='5s';

-- Descriptions use the existing publication authority; package bytes stay private.
alter table public.articles drop constraint articles_type_check;
alter table public.articles add constraint articles_type_check check(type in ('blog','chapter','skill'));
alter table public.articles drop constraint article_container_check;
alter table public.articles add constraint article_container_check check(
  (type in ('blog','skill') and series_id is null) or (type='chapter' and series_id is not null));
alter table public.articles drop constraint article_price_check;
alter table public.articles add constraint article_price_check check(
  (type='blog' and access='paid' and price is not null and price>0) or
  (type='blog' and access<>'paid' and price is null) or
  (type='chapter' and price is null) or (type='skill' and price is null and access='public'));
alter table public.orders drop constraint orders_sku_type_check;
alter table public.orders add constraint orders_sku_type_check check(sku_type in ('subscription','series','single','event','skill'));
alter table public.entitlements drop constraint entitlements_type_check;
alter table public.entitlements add constraint entitlements_type_check check(type in ('subscription','series','single','event','skill'));

create table public.skills (
  id bigint primary key references public.articles(id),
  price numeric(10,2) not null default 0 check(price>=0 and price<=999999.99),
  online_enabled boolean not null default false,
  usage_guide text not null default '' check(octet_length(usage_guide)<=16384),
  current_release uuid,
  legacy_series_id bigint unique references public.series(id),
  revision bigint not null default 1 check(revision>0),
  updated_at timestamptz not null default now()
);
create table public.skill_releases (
  id uuid primary key,
  skill_id bigint not null references public.skills(id),
  version text not null check(version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  notes text not null default '' check(octet_length(notes)<=16384),
  package_sha256 text not null check(package_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check(byte_size between 1 and 20971520),
  manifest jsonb not null check(jsonb_typeof(manifest)='array' and jsonb_array_length(manifest) between 1 and 500),
  skill_name text not null check(skill_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(skill_name)<=64),
  description text not null check(length(description) between 1 and 1024),
  online_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  unique(skill_id,version), unique(skill_id,id)
);
alter table public.skills add constraint skill_current_release_owner
  foreign key(id,current_release) references public.skill_releases(skill_id,id) deferrable initially deferred;
create table public.skill_uploads (
  id uuid primary key,
  skill_id bigint not null references public.skills(id),
  owner_id uuid not null references auth.users(id),
  version text not null check(version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  notes text not null default '' check(octet_length(notes)<=16384),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check(byte_size between 1 and 20971520),
  release_id uuid unique references public.skill_releases(id),
  confirming_until timestamptz,
  confirm_attempts integer not null default 0 check(confirm_attempts between 0 and 10),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours'
);
create index skill_upload_expiry on public.skill_uploads(expires_at) where release_id is null;
create index skill_upload_owner on public.skill_uploads(owner_id,created_at);
create table public.skill_install_grants (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id),
  release_id uuid not null references public.skill_releases(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '15 minutes',
  revoked_at timestamptz,
  exchanges integer not null default 0 check(exchanges between 0 and 6),
  check(expires_at>created_at and expires_at<=created_at+interval '15 minutes')
);
create index skill_install_user on public.skill_install_grants(user_id,created_at);

-- Deliberately separate from publishable avatar transcripts.
create table public.skill_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  release_id uuid not null references public.skill_releases(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index skill_sessions_user on public.skill_sessions(user_id,updated_at desc,id);
create table public.skill_turns (
  id uuid primary key,
  session_id uuid not null references public.skill_sessions(id),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  question text not null check(octet_length(question) between 1 and 16384),
  answer text check(octet_length(answer)<=131072),
  state text not null check(state in ('running','succeeded','failed','unknown')),
  lease_until timestamptz not null,
  created_at timestamptz not null default now()
);
create unique index skill_turn_running on public.skill_turns(session_id) where state='running';
create index skill_turn_history on public.skill_turns(session_id,created_at,id);

create table public.handbook_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  name text not null check(length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);
create index handbook_credentials_owner on public.handbook_credentials(owner_id);
create table public.handbook_sync_operations (
  id uuid primary key,
  credential_id uuid not null references public.handbook_credentials(id),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  operation text not null check(operation in ('create','stage','publish','activate','rename','order')),
  response jsonb,
  created_at timestamptz not null default now()
);
create index handbook_operations_credential on public.handbook_sync_operations(credential_id,created_at);

alter table public.skills enable row level security;
alter table public.skill_releases enable row level security;
alter table public.skill_uploads enable row level security;
alter table public.skill_install_grants enable row level security;
alter table public.skill_sessions enable row level security;
alter table public.skill_turns enable row level security;
alter table public.handbook_credentials enable row level security;
alter table public.handbook_sync_operations enable row level security;
revoke all on public.skills,public.skill_releases,public.skill_uploads,public.skill_install_grants,
 public.skill_sessions,public.skill_turns,public.handbook_credentials,public.handbook_sync_operations from public,anon,authenticated,service_role;
grant select,insert,update on public.skills,public.skill_uploads,public.skill_install_grants,
 public.skill_sessions,public.skill_turns,public.handbook_credentials,public.handbook_sync_operations to service_role;
grant select,insert on public.skill_releases to service_role;
grant select on public.skills to anon,authenticated;
create policy skills_public_read on public.skills for select to anon,authenticated using(
  exists(select 1 from public.articles a where a.id=skills.id and a.type='skill'));

drop policy articles_read on public.articles;
create policy articles_read on public.articles for select to anon,authenticated using(
 (select public.is_owner()) or (status in ('published','paused') and
 ((type in ('blog','skill') and series_id is null) or (type='chapter' and exists(
 select 1 from public.series s where s.id=articles.series_id and s.status in ('published','paused'))))));

create function public.begin_skill_turn(p_user uuid,p_skill bigint,p_session uuid,p_request uuid,p_question text)
returns jsonb language plpgsql set search_path='' as $$
declare session public.skill_sessions%rowtype; turn public.skill_turns%rowtype; release uuid; digest text;
begin
 if p_user is null or p_session is null or p_request is null or p_question is null or octet_length(p_question) not between 1 and 16384 then raise exception 'INVALID_TURN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('skill-turn:'||p_user::text,0));
 if not public.can_use_skill(p_skill,p_user) or not exists(select 1 from public.skills where id=p_skill and online_enabled) then raise exception 'FORBIDDEN'; end if;
 select * into session from public.skill_sessions where id=p_session for update;
 if found then
  if session.user_id<>p_user or not exists(select 1 from public.skill_releases where id=session.release_id and skill_id=p_skill and online_eligible) then raise exception 'SESSION_MISMATCH'; end if;
 else
  if (select count(*) from public.skill_sessions where user_id=p_user and created_at>now()-interval '1 day')>=30 then raise exception 'SESSION_LIMIT'; end if;
  select k.current_release into release from public.skills k join public.skill_releases r on r.id=k.current_release where k.id=p_skill and r.online_eligible;
  if release is null then raise exception 'ONLINE_UNAVAILABLE'; end if;
  insert into public.skill_sessions(id,user_id,release_id) values(p_session,p_user,release) returning * into session;
 end if;
 digest:=encode(sha256(convert_to(p_question,'UTF8')),'hex');
 update public.skill_turns set state='unknown' where session_id=session.id and state='running' and lease_until<now();
 select * into turn from public.skill_turns where id=p_request;
 if found then
  if turn.session_id<>session.id or turn.input_hash<>digest then raise exception 'TURN_CONFLICT'; end if;
  return jsonb_build_object('new',false,'id',turn.id,'state',turn.state,'answer',turn.answer,'release',session.release_id);
 end if;
 if exists(select 1 from public.skill_turns where session_id=session.id and state='running') then raise exception 'TURN_RUNNING'; end if;
 if (select count(*) from public.skill_turns where session_id=session.id)>=30 then raise exception 'SESSION_FULL'; end if;
 insert into public.skill_turns(id,session_id,input_hash,question,state,lease_until) values(p_request,session.id,digest,p_question,'running',now()+interval '60 seconds');
 update public.skill_sessions set updated_at=now() where id=session.id;
 return jsonb_build_object('new',true,'id',p_request,'state','running','release',session.release_id);
end $$;
revoke all on function public.begin_skill_turn(uuid,bigint,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_skill_turn(uuid,bigint,uuid,uuid,text) to service_role;

create function public.initialize_skill() returns trigger language plpgsql set search_path='' as $$
begin
 if new.type='skill' then insert into public.skills(id) values(new.id); end if;
 return new;
end $$;
revoke all on function public.initialize_skill() from public,anon,authenticated,service_role;
create trigger initialize_skill after insert on public.articles for each row execute function public.initialize_skill();

-- Callable only by the trusted application; arbitrary user IDs are never a client RPC.
create function public.can_use_skill(p_skill bigint,p_user uuid) returns boolean language sql stable set search_path='' as $$
 select p_user is not null and exists(select 1 from public.skills k join public.articles a on a.id=k.id
 where k.id=p_skill and a.type='skill' and (
 exists(select 1 from public.profiles p where p.id=p_user and p.is_owner) or
 (a.status in ('published','paused') and (k.price=0 or exists(select 1 from public.entitlements e
 where e.user_id=p_user and e.revoked_at is null and e.starts_at<=now() and (e.ends_at is null or e.ends_at>now())
 and (e.type='subscription' or (e.type='skill' and e.target_id=k.id) or
 (e.type='series' and e.target_id=k.legacy_series_id)))))))
$$;
revoke all on function public.can_use_skill(bigint,uuid) from public,anon,authenticated;
grant execute on function public.can_use_skill(bigint,uuid) to service_role;

create function public.reserve_skill_upload(p_id uuid,p_skill bigint,p_owner uuid,p_version text,p_notes text,p_hash text,p_size integer)
returns jsonb language plpgsql set search_path='' as $$
declare item public.skill_uploads%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('skill-upload:'||p_owner::text,0));
 select * into item from public.skill_uploads where id=p_id;
 if found then
  if item.skill_id<>p_skill or item.owner_id<>p_owner or item.version<>p_version or item.notes<>p_notes or item.source_hash<>p_hash or item.byte_size<>p_size then raise exception 'UPLOAD_CONFLICT'; end if;
  return to_jsonb(item);
 end if;
 if not exists(select 1 from public.skills k join public.articles a on a.id=k.id where k.id=p_skill and a.status<>'archived') then raise exception 'SKILL_UNAVAILABLE'; end if;
 if exists(select 1 from public.skill_releases where skill_id=p_skill and version=p_version) then raise exception 'VERSION_EXISTS'; end if;
 if (select count(*) from public.skill_uploads where owner_id=p_owner and release_id is null and expires_at>now())>=3
 or (select count(*) from public.skill_uploads where owner_id=p_owner and created_at>now()-interval '1 hour')>=30 then raise exception 'UPLOAD_RATE_LIMIT'; end if;
 insert into public.skill_uploads(id,skill_id,owner_id,version,notes,source_hash,byte_size) values(p_id,p_skill,p_owner,p_version,p_notes,p_hash,p_size) returning * into item;
 return to_jsonb(item);
end $$;
revoke all on function public.reserve_skill_upload(uuid,bigint,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.reserve_skill_upload(uuid,bigint,uuid,text,text,text,integer) to service_role;

create function public.claim_skill_confirmation(p_upload uuid,p_owner uuid) returns boolean language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then return false; end if;
 update public.skill_uploads set confirming_until=now()+interval '2 minutes',confirm_attempts=confirm_attempts+1
 where id=p_upload and owner_id=p_owner and release_id is null and expires_at>now() and confirm_attempts<10
 and (confirming_until is null or confirming_until<now());
 return found;
end $$;
revoke all on function public.claim_skill_confirmation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_skill_confirmation(uuid,uuid) to service_role;

create function public.issue_skill_install_grant(p_user uuid,p_release uuid,p_hash text) returns jsonb language plpgsql set search_path='' as $$
declare result public.skill_install_grants%rowtype; target bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended('skill-delivery:'||p_user::text,0));
 select skill_id into target from public.skill_releases where id=p_release;
 if target is null or not public.can_use_skill(target,p_user) then raise exception 'FORBIDDEN'; end if;
 if (select count(*) from public.skill_install_grants where user_id=p_user and created_at>now()-interval '1 hour')>=30 then raise exception 'RATE_LIMIT'; end if;
 insert into public.skill_install_grants(user_id,release_id,token_hash) values(p_user,p_release,p_hash) returning * into result;
 return jsonb_build_object('id',result.id,'expires_at',result.expires_at);
end $$;
revoke all on function public.issue_skill_install_grant(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.issue_skill_install_grant(uuid,uuid,text) to service_role;

create function public.redeem_skill_install_grant(p_hash text) returns jsonb language plpgsql set search_path='' as $$
declare item public.skill_install_grants%rowtype; target bigint;
begin
 select * into item from public.skill_install_grants where token_hash=p_hash for update;
 if not found or item.revoked_at is not null or item.expires_at<=now()+interval '1 second' or item.exchanges>=6 then raise exception 'GRANT_UNAVAILABLE'; end if;
 select skill_id into target from public.skill_releases where id=item.release_id;
 if not public.can_use_skill(target,item.user_id) then raise exception 'FORBIDDEN'; end if;
 update public.skill_install_grants set exchanges=exchanges+1 where id=item.id;
 return jsonb_build_object('release_id',item.release_id,'expires_at',item.expires_at);
end $$;
revoke all on function public.redeem_skill_install_grant(text) from public,anon,authenticated;
grant execute on function public.redeem_skill_install_grant(text) to service_role;

create function public.confirm_skill_release(p_upload uuid,p_owner uuid,p_manifest jsonb,p_name text,p_description text,p_online boolean)
returns uuid language plpgsql set search_path='' as $$
declare item public.skill_uploads%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select * into item from public.skill_uploads where id=p_upload and owner_id=p_owner for update;
 if not found then raise exception 'UPLOAD_NOT_FOUND'; end if;
 if item.release_id is not null then return item.release_id; end if;
 if item.expires_at<=now() then raise exception 'UPLOAD_EXPIRED'; end if;
 insert into public.skill_releases(id,skill_id,version,notes,package_sha256,byte_size,manifest,skill_name,description,online_eligible)
 values(item.id,item.skill_id,item.version,item.notes,item.source_hash,item.byte_size,p_manifest,p_name,p_description,p_online);
 update public.skill_uploads set release_id=item.id where id=item.id;
 return item.id;
end $$;
revoke all on function public.confirm_skill_release(uuid,uuid,jsonb,text,text,boolean) from public,anon,authenticated;
grant execute on function public.confirm_skill_release(uuid,uuid,jsonb,text,text,boolean) to service_role;

create function public.save_skill_settings(p_id bigint,p_owner uuid,p_revision bigint,p_price numeric,p_release uuid,p_online boolean,p_guide text)
returns bigint language plpgsql set search_path='' as $$
declare current_item public.skills%rowtype;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 select * into current_item from public.skills where id=p_id for update;
 if not found or current_item.revision<>p_revision then raise exception 'SETTINGS_CONFLICT'; end if;
 if p_online and not exists(select 1 from public.skill_releases where id=p_release and skill_id=p_id and online_eligible) then raise exception 'ONLINE_UNAVAILABLE'; end if;
 update public.skills set price=p_price,current_release=p_release,online_enabled=p_online,usage_guide=p_guide,revision=revision+1,updated_at=now() where id=p_id;
 return p_revision+1;
end $$;
revoke all on function public.save_skill_settings(bigint,uuid,bigint,numeric,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.save_skill_settings(bigint,uuid,bigint,numeric,uuid,boolean,text) to service_role;

CREATE OR REPLACE FUNCTION public.commit_publication(p_request_id text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  fm jsonb := p_payload->'frontmatter';
  item public.articles%rowtype;
  parent public.series%rowtype;
  latest public.article_versions%rowtype;
  diagnostics jsonb := coalesce(p_payload->'diagnostics', '[]'::jsonb);
  item_id bigint;
  next_version integer;
  detail text;
  content_url text;
  base text;
  paths jsonb;
  error_code text;
  error_message text;
begin
  perform pg_catalog.pg_advisory_xact_lock(71001, pg_catalog.hashtext(p_request_id));
  select response into result from public.publish_requests where client_request_id = p_request_id;
  if found then return result; end if;

  if p_payload->>'status' = 'blocked' then
    result := p_payload - 'status' || jsonb_build_object('status', 'blocked');
  else
    perform pg_catalog.pg_advisory_xact_lock(71002, pg_catalog.hashtext(fm->>'slug'));
    if fm->>'type' = 'chapter' then
      select * into parent from public.series where slug = fm->>'series_slug' for update;
      if not found then
        error_code := 'SERIES_NOT_FOUND'; error_message := '所属专辑不存在。';
      elsif parent.status = 'archived' then
        error_code := 'SCHEMA_INVALID'; error_message := '不能向已归档专辑发布。';
      end if;
    end if;
    select * into item from public.articles where slug = fm->>'slug' for update;
    if found and (item.status = 'archived' or item.type <> fm->>'type' or item.series_id is distinct from parent.id) then
      error_code := 'SCHEMA_INVALID'; error_message := '不能重发已归档文章或改变现有文章的类型和专辑归属。';
    end if;
    if p_payload ? 'expected_updated_at' and (item.id is null or item.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz) then
      error_code := 'SCHEMA_INVALID'; error_message := '内容已更新，请刷新后重试。';
    end if;
    if item.id is not null and parent.readme_article_id = item.id and fm->>'access' <> 'public' then
      error_code := 'SCHEMA_INVALID'; error_message := 'README 必须公开。';
    end if;
    if fm->>'type'='skill' and (fm->>'access'<>'public' or fm ? 'price' or fm ? 'series_slug') then
      error_code:='SCHEMA_INVALID'; error_message:='Skill 介绍必须公开，售价在 Skill 设置中管理。';
    end if;
    if error_code is not null then
      diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', error_code, 'severity', 'error', 'message', error_message, 'path', '/frontmatter'));
      result := jsonb_build_object('status', 'blocked', 'diagnostics', diagnostics, 'article', null, 'revalidated', '[]'::jsonb);
    else
      if parent.price > 0 and fm->>'access' = 'subscriber' then
        diagnostics := diagnostics || jsonb_build_array(jsonb_build_object('code', 'SUBSCRIBER_IN_PAID_SERIES', 'severity', 'warning', 'message', '订阅内容不参与专辑单卖。', 'path', '/frontmatter/access'));
      end if;
      if fm->>'type' in ('blog','skill') then
        base := case fm->>'type' when 'skill' then '/skills' else '/blog' end; detail := base || '/' || (fm->>'slug');
      else
        base := case parent.type when 'collection' then '/collections' when 'handbook' then '/handbooks' when 'skill' then '/skills' when 'event' then '/events' end;
        detail := base || '/' || parent.slug;
      end if;
      paths := jsonb_build_array('/', base, detail, '/llms.txt', '/card', '/card.json');
      content_url := detail || case when parent.id is not null then '?article=' || (fm->>'slug') else '' end;
      select * into latest from public.article_versions where article_id = item.id order by version desc limit 1;
      if latest.content_hash = p_payload->>'content_hash' then
        next_version := latest.version;
      else
        insert into public.articles (slug, series_id, type, title, summary, cover_url, tags, access, price, preview_md, status, published_at)
        values (fm->>'slug', parent.id, fm->>'type', fm->>'title', fm->>'summary', p_payload->>'cover',
          array(select jsonb_array_elements_text(coalesce(fm->'tags', '[]'::jsonb))), fm->>'access', (fm->>'price')::numeric,
          p_payload->>'preview', coalesce(nullif(item.status, 'draft'), 'published'), coalesce((fm->>'published_at')::timestamptz, item.published_at, now()))
        on conflict (slug) do update set title = excluded.title, summary = excluded.summary, cover_url = excluded.cover_url,
          tags = excluded.tags, access = excluded.access, price = excluded.price, preview_md = excluded.preview_md,
          status = excluded.status, published_at = excluded.published_at
        returning id into item_id;
        insert into public.article_bodies (article_id, content) values (item_id, p_payload->>'markdown')
          on conflict (article_id) do update set content = excluded.content;
        next_version := coalesce(latest.version, 0) + 1;
        insert into public.article_versions (article_id, version, content_hash, snapshot, client_request_id)
          values (item_id, next_version, p_payload->>'content_hash', p_payload->'snapshot', p_request_id);
        delete from public.article_chunks where article_id = item_id;
        insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
          values (item_id, parent.id, 'public', 'catalog', 0, (fm->>'title') || E'\n' || coalesce(fm->>'summary', ''), content_url);
        if fm->>'access' = 'public' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', case when parent.readme_article_id = item_id then 'readme' else 'body' end, 1, p_payload->>'markdown', content_url);
        elsif coalesce(p_payload->>'preview', '') <> '' then
          insert into public.article_chunks (article_id, series_id, access, chunk_type, chunk_no, content, source_path)
            values (item_id, parent.id, 'public', 'preview', 1, p_payload->>'preview', content_url);
        end if;
      end if;
      result := jsonb_build_object('status', case when jsonb_array_length(diagnostics) > 0 then 'needs_user_action' else 'pass' end,
        'diagnostics', diagnostics, 'article', jsonb_build_object('slug', fm->>'slug', 'version', next_version,
          'url', content_url), 'revalidated', paths);
    end if;
  end if;
  insert into public.publish_requests (client_request_id, status, response) values (p_request_id, result->>'status', result);
  return result;
end;
$function$;


create or replace function public.create_pending_order(p_user_id uuid,p_sku text,p_target bigint,p_amount numeric)
returns jsonb language plpgsql set search_path='' as $$
declare v_price numeric; v_order public.orders%rowtype;
begin
  -- Revalidate the server price snapshot while holding a shared product/configuration lock.
  if p_sku='subscription' and p_target is null then
    select (commerce->'subscription_price'->>'amount')::numeric into v_price from public.site_config where id=1 for share;
  elsif p_sku='series' then
    select price into v_price from public.series where id=p_target and type in ('collection','handbook','skill') and status='published'
      and not exists(select 1 from public.skills k where k.legacy_series_id=series.id) for share;
  elsif p_sku='skill' then
    select k.price into v_price from public.skills k join public.articles a on a.id=k.id
      where k.id=p_target and a.type='skill' and a.status='published' and k.current_release is not null for share of k,a;
  elsif p_sku='single' then
    select price into v_price from public.articles where id=p_target and type='blog' and series_id is null and access='paid' and status='published' for share;
  elsif p_sku='event' then
    select d.ticket_price into v_price from public.event_details d join public.series s on s.id=d.series_id
      where s.id=p_target and s.type='event' and s.status='published' and d.state in ('upcoming','registering') for share of s,d;
  end if;
  if v_price is null or v_price<=0 or p_amount is null or p_amount<>v_price then raise exception 'NOT_SELLABLE'; end if;
  perform pg_advisory_xact_lock(hashtextextended('order-entitlement:' || p_user_id::text || ':' || p_sku || ':' || coalesce(p_target::text,''),0));
  if (p_sku='skill' and public.can_use_skill(p_target,p_user_id)) or exists(select 1 from public.entitlements e where e.user_id=p_user_id and e.revoked_at is null and (e.ends_at is null or e.ends_at>now())
    and (e.type='subscription' or (e.type=p_sku and e.target_id is not distinct from p_target))) then raise exception 'ALREADY_ENTITLED'; end if;
  select * into v_order from public.orders where user_id=p_user_id and sku_type=p_sku
    and target_id is not distinct from p_target and amount=v_price and status='pending' and provider='zpay'
    order by created_at desc,id desc limit 1;
  if found then return to_jsonb(v_order); end if;
  insert into public.orders(user_id,sku_type,target_id,amount) values(p_user_id,p_sku,p_target,v_price) returning * into v_order;
  return to_jsonb(v_order);
end $$;


create or replace function public.queue_grant_email() returns trigger language plpgsql set search_path='' as $$
declare v_order public.orders%rowtype; v_title text; v_site text;
begin
  if current_setting('youai.queue_mail',true) is distinct from 'on' or new.source<>'order' then return new; end if;
  select * into v_order from public.orders where 'order:'||id::text=new.source_ref
    and status='paid' and user_id=new.user_id and sku_type=new.type and target_id is not distinct from new.target_id;
  if not found then raise exception 'MAIL_ORDER_BINDING_REQUIRED'; end if;
  if v_order.sku_type='subscription' then v_title:='全站订阅（1 年）';
  elsif v_order.sku_type in ('single','skill') then select title into v_title from public.articles where id=v_order.target_id;
  else select title into v_title from public.series where id=v_order.target_id;
  end if;
  select site_name into v_site from public.site_config where id=1;
  insert into public.email_outbox(order_id,entitlement_id,snapshot)
  values(v_order.id,new.id,jsonb_build_object('version',1,'user_id',new.user_id,'order_id',v_order.id,
    'site_name',coalesce(v_site,'站点'),'description',coalesce(v_title,'已购内容'),'ends_at',new.ends_at));
  return new;
end $$;

alter table public.ai_calls drop constraint ai_calls_task_check;
alter table public.ai_calls add constraint ai_calls_task_check check(task in ('avatar','page','generation_probe','embedding_probe','retrieval','knowledge_questions','knowledge_preview','knowledge_preview_retrieval','skill'));

create or replace function public.reserve_ai_call(p_request uuid,p_task text,p_connection uuid,p_user uuid,p_ip text)
returns text language plpgsql security invoker set search_path='' as $$
declare cfg public.ai_settings; old_call public.ai_calls; owner_user boolean; cap integer; v_now timestamptz; start_day timestamptz;
begin
 if p_request is null or p_task is null or p_task not in ('avatar','page','generation_probe','embedding_probe','retrieval','knowledge_questions','knowledge_preview','knowledge_preview_retrieval','skill')
  or p_connection is null or length(coalesce(p_ip,''))>128 or (p_user is null and nullif(p_ip,'') is null) then raise exception 'INVALID_AI_CALL'; end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'AI_BUDGET_REQUIRES_READ_COMMITTED'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-call-budget',0));
 v_now:=clock_timestamp();start_day:=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
 select * into old_call from public.ai_calls where request_id=p_request;
 if found then
  if old_call.task is distinct from p_task or old_call.connection_id is distinct from p_connection
   or old_call.user_id is distinct from p_user or old_call.ip is distinct from p_ip then raise exception 'AI_CALL_MISMATCH'; end if;
  return 'duplicate';
 end if;
 select * into cfg from public.ai_settings where id=1;
 if p_user is not null then
  select is_owner into owner_user from public.profiles where id=p_user;
  if not found then raise exception 'INVALID_AI_PRINCIPAL'; end if;
 else owner_user:=false; end if;
 if p_task='skill' and p_user is null then raise exception 'USER_REQUIRED'; end if;
 if p_task in ('page','generation_probe','embedding_probe','knowledge_questions','knowledge_preview','knowledge_preview_retrieval') and not owner_user then raise exception 'OWNER_REQUIRED'; end if;
 if p_task in ('avatar','retrieval') and (not cfg.avatar_enabled or
  not exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true') or (p_user is null and not cfg.anonymous_entry)) then return 'disabled'; end if;
 if p_task in ('page','avatar','generation_probe','knowledge_questions','knowledge_preview','skill') and p_connection is distinct from cfg.generation_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task in ('embedding_probe','knowledge_preview_retrieval') and p_connection is distinct from cfg.embedding_connection then raise exception 'AI_CONNECTION_CHANGED'; end if;
 if p_task not in ('generation_probe','embedding_probe') and not exists(select 1 from public.ai_connections where id=p_connection and verified_at is not null) then return 'unverified'; end if;
 cap:=case when p_task in ('generation_probe','embedding_probe') then 20 when p_task in ('page','knowledge_questions','knowledge_preview','knowledge_preview_retrieval') then 60
  when p_task='retrieval' then case when p_user is null then 15 else 300 end
  when p_user is null then 5
  when exists(select 1 from public.entitlements where user_id=p_user and revoked_at is null and type='subscription'
    and starts_at<=v_now and (ends_at is null or ends_at>v_now)) then 100 else 20 end;
 if (not owner_user or p_task<>'avatar') and ((select count(*) from public.ai_calls where created_at>=start_day and task=p_task
   and state<>'released' and (state<>'reserved' or expires_at>v_now)
   and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) +
   case when p_task='avatar' then (select count(*) from public.avatar_usage where created_at>=start_day and generation_state<>'released'
    and (generation_state<>'reserved' or reservation_expires_at>v_now)
    and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end) else 0 end)>=cap then return 'daily_limit'; end if;
 if (select count(*) from public.ai_calls where created_at>v_now-interval '1 minute' and task=p_task
   and state<>'released' and case when p_user is null then user_id is null and ip=p_ip else user_id=p_user end)>=5 then return 'rate_limit'; end if;
 if p_task in ('avatar','page','knowledge_questions','knowledge_preview','skill') and cfg.monthly_limit is not null and (
  (select count(*) from public.ai_calls where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and task in ('avatar','page','knowledge_questions','knowledge_preview','skill') and state<>'released' and (state<>'reserved' or expires_at>v_now)) +
  (select count(*) from public.avatar_usage where created_at>=date_trunc('month',v_now at time zone 'UTC') at time zone 'UTC'
    and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>v_now)))>=cfg.monthly_limit then return 'monthly_limit'; end if;
 insert into public.ai_calls(request_id,task,connection_id,user_id,ip,state,expires_at,created_at)
 values(p_request,p_task,p_connection,p_user,p_ip,'reserved',v_now+interval '60 seconds',v_now);
 return 'reserved';
end $$;

create or replace function public.dispatch_ai_call(p_request uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed uuid;
begin
 update public.ai_calls set state='dispatched' where request_id=p_request and state='reserved' and expires_at>clock_timestamp()
  and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC'
  and exists(select 1 from public.ai_settings s where s.id=1 and
   case when task in ('avatar','page','generation_probe','knowledge_questions','knowledge_preview','skill') then s.generation_connection=connection_id
    when task in ('embedding_probe','knowledge_preview_retrieval') then s.embedding_connection=connection_id else true end
   and (task not in ('avatar','retrieval') or (s.avatar_enabled and (user_id is not null or s.anonymous_entry)
    and exists(select 1 from public.site_config where id=1 and avatar_config->>'enabled'='true'))))
  returning request_id into changed;
 return changed is not null;
end $$;

update public.app_schema_version set version='20261024020015',applied_at=now() where id=1;

-- Source migration: 20261024072558_handbook_sync_authority.sql

set local lock_timeout='5s';

alter table public.handbook_credentials add column request_window timestamptz not null default now();
alter table public.handbook_credentials add column request_count integer not null default 0 check(request_count>=0);
create table public.handbook_media_uploads (
 id uuid primary key references public.media_uploads(id),
 credential_id uuid not null references public.handbook_credentials(id),
 series_id bigint not null references public.series(id)
);
create index handbook_media_credential on public.handbook_media_uploads(credential_id,series_id);
alter table public.handbook_media_uploads enable row level security;
revoke all on public.handbook_media_uploads from public,anon,authenticated,service_role;
grant select,insert on public.handbook_media_uploads to service_role;

create function public.create_handbook_credential(p_owner uuid,p_name text,p_hash text) returns uuid language plpgsql set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('handbook-credentials:'||p_owner::text,0));
 if (select count(*) from public.handbook_credentials where owner_id=p_owner and revoked_at is null)>=10 then raise exception 'CREDENTIAL_LIMIT'; end if;
 insert into public.handbook_credentials(owner_id,name,token_hash) values(p_owner,p_name,p_hash) returning id into result;
 return result;
end $$;
revoke all on function public.create_handbook_credential(uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_handbook_credential(uuid,text,text) to service_role;

create function public.handbook_principal(p_credential uuid,p_series bigint default null) returns uuid language plpgsql set search_path='' as $$
declare principal uuid;
begin
 select owner_id into principal from public.handbook_credentials where id=p_credential and revoked_at is null for share;
 if principal is null or not exists(select 1 from public.profiles where id=principal and is_owner) then raise exception 'CREDENTIAL_REVOKED'; end if;
 if p_series is not null then
  perform 1 from public.series where id=p_series and type='handbook' and status<>'archived' for update;
  if not found then raise exception 'HANDBOOK_REQUIRED'; end if;
 end if;
 return principal;
end $$;
create function public.touch_handbook_credential(p_hash text) returns jsonb language plpgsql set search_path='' as $$
declare item public.handbook_credentials%rowtype;
begin
 select * into item from public.handbook_credentials where token_hash=p_hash and revoked_at is null for update;
 if not found then raise exception 'CREDENTIAL_REVOKED'; end if;
 perform public.handbook_principal(item.id);
 if item.request_window>now()-interval '1 minute' and item.request_count>=180 then raise exception 'RATE_LIMIT'; end if;
 update public.handbook_credentials set last_used_at=now(),request_window=case when item.request_window<=now()-interval '1 minute' then now() else item.request_window end,
 request_count=case when item.request_window<=now()-interval '1 minute' then 1 else item.request_count+1 end where id=item.id;
 return jsonb_build_object('id',item.id,'owner_id',item.owner_id);
end $$;
create function public.handbook_operation(p_credential uuid,p_id uuid,p_hash text,p_kind text) returns jsonb language plpgsql set search_path='' as $$
declare item public.handbook_sync_operations%rowtype;
begin
 perform public.handbook_principal(p_credential);
 perform pg_advisory_xact_lock(hashtextextended('handbook-operation:'||p_id::text,0));
 select * into item from public.handbook_sync_operations where id=p_id;
 if found then
  if item.credential_id<>p_credential or item.request_hash<>p_hash or item.operation<>p_kind then raise exception 'OPERATION_CONFLICT'; end if;
  return item.response;
 end if;
 insert into public.handbook_sync_operations(id,credential_id,request_hash,operation) values(p_id,p_credential,p_hash,p_kind);
 return null;
end $$;
create function public.create_synced_handbook(p_credential uuid,p_operation uuid,p_hash text,p_slug text,p_title text) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; item public.series%rowtype;
begin
 result:=public.handbook_operation(p_credential,p_operation,p_hash,'create'); if result is not null then return result; end if;
 if p_slug !~ '^[a-z0-9][a-z0-9-]{1,119}$' or length(p_title) not between 1 and 180 then raise exception 'INVALID_HANDBOOK'; end if;
 insert into public.series(slug,title,type,status,price) values(p_slug,p_title,'handbook','draft',0) returning * into item;
 result:=jsonb_build_object('id',item.id,'slug',item.slug,'scope','series:'||item.slug,'status',item.status);
 update public.handbook_sync_operations set response=result where id=p_operation;
 return result;
end $$;
create function public.stage_handbook_file(p_credential uuid,p_operation uuid,p_hash text,p_scope text,p_path text,p_slug text,p_input_hash text,p_snapshot jsonb,p_expected bigint,p_updated timestamptz,p_access_change boolean)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; parent bigint; current_item public.articles%rowtype; revision bigint;
begin
 select id into parent from public.series where slug=substring(p_scope from 8) and p_scope like 'series:%';
 if parent is null then raise exception 'HANDBOOK_REQUIRED'; end if;
 perform public.handbook_principal(p_credential,parent);
 result:=public.handbook_operation(p_credential,p_operation,p_hash,'stage'); if result is not null then return result; end if;
 select * into current_item from public.articles where slug=p_slug for update;
 if current_item.id is not null and (current_item.series_id is distinct from parent or current_item.type<>'chapter') then raise exception 'TARGET_MISMATCH'; end if;
 if current_item.updated_at is distinct from p_updated then raise exception 'ONLINE_CHANGED'; end if;
 if current_item.id is not null and current_item.access<>(p_snapshot->'frontmatter'->>'access') and p_access_change is distinct from true then raise exception 'ACCESS_CONFIRMATION_REQUIRED'; end if;
 if p_snapshot->'frontmatter'->>'type'<>'chapter' or p_snapshot->'frontmatter'->>'series_slug'<>substring(p_scope from 8) then raise exception 'TARGET_MISMATCH'; end if;
 if lower(p_path)='readme.md' and p_snapshot->'frontmatter'->>'access'<>'public' then raise exception 'README_PUBLIC_REQUIRED'; end if;
 revision:=public.stage_content_file(p_scope,p_path,p_slug,p_input_hash,p_snapshot,p_expected,p_operation::text);
 result:=jsonb_build_object('id',revision);
 update public.handbook_sync_operations set response=result where id=p_operation;
 return result;
end $$;
create function public.publish_handbook_revision(p_credential uuid,p_operation uuid,p_hash text,p_revision bigint,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; parent bigint;
begin
 select s.id into parent from public.content_file_revisions r join public.content_files f on f.id=r.file_id join public.series s on f.scope='series:'||s.slug where r.id=p_revision;
 if parent is null then raise exception 'HANDBOOK_REQUIRED'; end if;
 perform public.handbook_principal(p_credential,parent);
 result:=public.handbook_operation(p_credential,p_operation,p_hash,'publish'); if result is not null then return result; end if;
 result:=public.commit_file_publication(p_revision,p_payload);
 update public.handbook_sync_operations set response=result where id=p_operation;
 return result;
end $$;
create function public.activate_synced_handbook(p_credential uuid,p_operation uuid,p_hash text,p_series bigint,p_readme bigint,p_updated timestamptz)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; item public.series%rowtype; readme bigint;
begin
 perform public.handbook_principal(p_credential,p_series);
 result:=public.handbook_operation(p_credential,p_operation,p_hash,'activate'); if result is not null then return result; end if;
 select * into item from public.series where id=p_series for update;
 if item.status<>'draft' or item.updated_at is distinct from p_updated then raise exception 'ONLINE_CHANGED'; end if;
 select a.id into readme from public.content_file_revisions r join public.content_files f on f.id=r.file_id join public.articles a on a.slug=f.article_slug
 where r.id=p_readme and f.scope='series:'||item.slug and lower(f.path)='readme.md' and a.series_id=p_series and a.access='public' and a.status='published'
 and r.publication->>'status' in ('pass','needs_user_action');
 if readme is null then raise exception 'README_REQUIRED'; end if;
 if exists(select 1 from public.content_files f join public.content_file_heads h on h.file_id=f.id where f.scope='series:'||item.slug and (h.publication is null or h.publication->>'status'='blocked')) then raise exception 'INCOMPLETE_BATCH'; end if;
 update public.series set readme_article_id=readme,status='published' where id=p_series;
 result:=jsonb_build_object('id',p_series,'status','published');
 update public.handbook_sync_operations set response=result where id=p_operation;
 return result;
end $$;
create function public.rename_handbook_file(p_credential uuid,p_operation uuid,p_hash text,p_file bigint,p_path text,p_expected bigint)
returns jsonb language plpgsql set search_path='' as $$
declare result jsonb; parent bigint; latest bigint;
begin
 select s.id into parent from public.content_files f join public.series s on f.scope='series:'||s.slug where f.id=p_file;
 if parent is null then raise exception 'HANDBOOK_REQUIRED'; end if;
 perform public.handbook_principal(p_credential,parent);
 result:=public.handbook_operation(p_credential,p_operation,p_hash,'rename'); if result is not null then return result; end if;
 select id into latest from public.content_file_revisions where file_id=p_file order by version desc limit 1;
 if latest is distinct from p_expected then raise exception 'ONLINE_CHANGED'; end if;
 if p_path ~ '(^/|(^|/)\.\.?(/|$)|[\\])' or length(p_path)>1024 then raise exception 'INVALID_PATH'; end if;
 update public.content_files set path=p_path where id=p_file;
 result:=jsonb_build_object('id',p_file,'path',p_path);
 update public.handbook_sync_operations set response=result where id=p_operation;
 return result;
end $$;
create function public.prepare_handbook_image(p_credential uuid,p_series bigint,p_id uuid,p_name text,p_hash text,p_mime text,p_size integer)
returns jsonb language plpgsql set search_path='' as $$
declare principal uuid; result jsonb;
begin
 principal:=public.handbook_principal(p_credential,p_series);
 if exists(select 1 from public.media_uploads where id=p_id) and not exists(select 1 from public.handbook_media_uploads where id=p_id and credential_id=p_credential and series_id=p_series) then raise exception 'UPLOAD_CONFLICT'; end if;
 result:=public.reserve_media_upload(p_id,principal,p_name,p_hash,p_mime,p_size);
 insert into public.handbook_media_uploads(id,credential_id,series_id) values(p_id,p_credential,p_series) on conflict(id) do nothing;
 return result;
end $$;

revoke all on function public.handbook_principal(uuid,bigint),public.touch_handbook_credential(text),public.handbook_operation(uuid,uuid,text,text),
 public.create_synced_handbook(uuid,uuid,text,text,text),public.stage_handbook_file(uuid,uuid,text,text,text,text,text,jsonb,bigint,timestamptz,boolean),
 public.publish_handbook_revision(uuid,uuid,text,bigint,jsonb),public.activate_synced_handbook(uuid,uuid,text,bigint,bigint,timestamptz),
 public.rename_handbook_file(uuid,uuid,text,bigint,text,bigint),public.prepare_handbook_image(uuid,bigint,uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.handbook_principal(uuid,bigint),public.touch_handbook_credential(text),public.handbook_operation(uuid,uuid,text,text),
 public.create_synced_handbook(uuid,uuid,text,text,text),public.stage_handbook_file(uuid,uuid,text,text,text,text,text,jsonb,bigint,timestamptz,boolean),
 public.publish_handbook_revision(uuid,uuid,text,bigint,jsonb),public.activate_synced_handbook(uuid,uuid,text,bigint,bigint,timestamptz),
 public.rename_handbook_file(uuid,uuid,text,bigint,text,bigint),public.prepare_handbook_image(uuid,bigint,uuid,text,text,text,integer) to service_role;

create function public.link_handbook_image(p_credential uuid,p_series bigint,p_upload uuid,p_path text,p_expected text)
returns jsonb language plpgsql set search_path='' as $$
declare v_scope text; ticket public.media_uploads%rowtype; asset public.media_assets%rowtype; current_hash text; v_media jsonb;
begin
 perform public.handbook_principal(p_credential,p_series);
 if not exists(select 1 from public.handbook_media_uploads where id=p_upload and credential_id=p_credential and series_id=p_series) then raise exception 'UPLOAD_MISMATCH'; end if;
 select * into ticket from public.media_uploads where id=p_upload;
 select * into asset from public.media_assets where id=ticket.asset_id and not archived;
 if asset.id is null then raise exception 'UPLOAD_UNFINISHED'; end if;
 select 'series:'||slug into v_scope from public.series where id=p_series;
 perform pg_advisory_xact_lock(hashtextextended('handbook-asset:'||v_scope||'/'||p_path,0));
 select source_hash into current_hash from public.content_assets a where a.scope=v_scope and a.path=p_path for update;
 if current_hash=ticket.source_hash then return jsonb_build_object('hash',current_hash); end if;
 if current_hash is distinct from p_expected then raise exception 'ASSET_CONFLICT'; end if;
 v_media:=jsonb_build_object('source_path',p_path,'storage_path',asset.storage_path,'sha256',asset.sha256,'mime_type',asset.mime_type,'width',asset.width,'height',asset.height);
 insert into public.content_assets(scope,path,source_hash,media) values(v_scope,p_path,ticket.source_hash,v_media)
 on conflict(scope,path) do update set source_hash=excluded.source_hash,media=excluded.media,updated_at=now();
 return jsonb_build_object('hash',ticket.source_hash);
end $$;
revoke all on function public.link_handbook_image(uuid,bigint,uuid,text,text) from public,anon,authenticated;
grant execute on function public.link_handbook_image(uuid,bigint,uuid,text,text) to service_role;

update public.app_schema_version set version='20261024072558' where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261024131326_skill_compatibility_and_delivery.sql

set local lock_timeout='5s';

-- Invoked explicitly after deploying the compatible application. No existing order,
-- entitlement, chapter body, or historical price snapshot is rewritten.
create function public.migrate_content_kinds(p_owner uuid) returns jsonb
language plpgsql set search_path='' as $$
declare old_series public.series%rowtype; intro text; fm jsonb; result jsonb; new_id bigint; converted integer:=0; handbooks integer;
begin
 if not exists(select 1 from public.profiles where id=p_owner and is_owner) then raise exception 'OWNER_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended('migrate-content-kinds',0));
 if exists(select 1 from public.series s where s.type='skill' and not exists(select 1 from public.skills k where k.legacy_series_id=s.id)
   and (exists(select 1 from public.articles a where a.slug=s.slug) or exists(select 1 from public.content_files f where f.article_slug=s.slug))) then
   raise exception 'SKILL_SLUG_CONFLICT: resolve conflicting article slugs before conversion';
 end if;
 for old_series in select s.* from public.series s where s.type='skill' and not exists(select 1 from public.skills k where k.legacy_series_id=s.id) order by s.id for update loop
   intro:=null;
   select b.content into intro from public.articles a join public.article_bodies b on b.article_id=a.id
    where a.id=old_series.readme_article_id and a.series_id=old_series.id and a.access='public';
   intro:=coalesce(intro,old_series.task,'');
   fm:=jsonb_build_object('title',old_series.title,'slug',old_series.slug,'type','skill','access','public','summary',coalesce(old_series.task,''));
   result:=public.commit_publication('legacy-skill-'||old_series.id::text,jsonb_build_object('frontmatter',fm,'markdown',intro,'preview',intro,
     'content_hash',encode(sha256(convert_to(fm::text||intro,'UTF8')),'hex'),'snapshot',jsonb_build_object('frontmatter',fm,'markdown',intro,'media','[]'::jsonb),'diagnostics','[]'::jsonb));
   if result->>'status' not in ('pass','needs_user_action') then raise exception 'SKILL_CONVERSION_BLOCKED'; end if;
   select id into new_id from public.articles where slug=old_series.slug and type='skill';
   if new_id is null then raise exception 'SKILL_CONVERSION_BLOCKED'; end if;
   update public.articles set status=old_series.status,paused_at=old_series.paused_at where id=new_id;
   update public.skills set price=old_series.price,legacy_series_id=old_series.id,updated_at=now() where id=new_id;
   converted:=converted+1;
 end loop;
 update public.series set type='handbook' where type='collection';
 get diagnostics handbooks=row_count;
 return jsonb_build_object('skills',converted,'handbooks',handbooks);
end $$;
revoke all on function public.migrate_content_kinds(uuid) from public,anon,authenticated;
grant execute on function public.migrate_content_kinds(uuid) to service_role;

-- Export reusable Skill metadata; runtime credentials and private chat history stay out.
create function public.export_site_snapshot(p_include_media boolean,p_include_skills boolean) returns jsonb
language sql stable security invoker set search_path='' as $$
 with saved as materialized (select public.export_site_snapshot(p_include_media) value)
 select case when p_include_skills then saved.value || jsonb_build_object('rows',
   (saved.value->'rows') || jsonb_build_object(
     'skills',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.skills s),
     'skill_releases',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from public.skill_releases s)))
 else saved.value end from saved;
$$;
revoke all on function public.export_site_snapshot(boolean,boolean) from public,anon,authenticated;
grant execute on function public.export_site_snapshot(boolean,boolean) to service_role;

create or replace view public.admin_documents with (security_invoker=true) as
with files as (
 select f.id file_id,f.article_slug,f.scope,f.path,f.sort,
   h.id head_id,h.version head_version,h.created_at head_created_at,h.publication,
   case when h.publication is null then h.snapshot->'frontmatter'->>'title' end pending_title,
   case when h.publication is null then h.snapshot->'frontmatter'->>'access' end pending_access
 from public.content_files f
 left join lateral (select r.id,r.version,r.created_at,r.publication,r.snapshot
   from public.content_file_revisions r where r.file_id=f.id order by r.version desc limit 1) h on true
)
select coalesce('f:'||f.file_id::text,'a:'||a.id::text) document_key,
 a.id article_id,f.file_id,a.slug online_slug,coalesce(a.slug,f.article_slug) slug,
 coalesce(a.title,f.pending_title,f.article_slug) title,f.pending_title,
 concat_ws(' ',a.title,f.pending_title,f.article_slug) search_text,
 coalesce(a.type,case when f.scope='blog' then 'blog' when f.scope='skill' then 'skill' else 'chapter' end) type,
 coalesce(a.series_id,scoped.id) series_id,s.title series_title,s.slug series_slug,s.type series_type,
 a.status,a.paused_at,coalesce(a.access,f.pending_access,'public') access,a.price,coalesce(a.featured,false) featured,
 coalesce(a.sort_order,f.sort,0) sort_order,
 coalesce(f.scope,case when a.type='skill' then 'skill' when a.series_id is null then 'blog' else 'series:'||s.slug end) scope,f.path,
 case when f.publication is null then f.head_id end pending_revision_id,
 case when f.publication is null then f.head_version end pending_version,
 coalesce(v.version,0) online_version,
 coalesce(greatest(a.updated_at,case when f.publication is null then f.head_created_at end),f.head_created_at) updated_at,
 (a.id is not null and s.readme_article_id=a.id) is_readme
from public.articles a full join files f on f.article_slug=a.slug
left join public.series scoped on f.scope='series:'||scoped.slug
left join public.series s on s.id=coalesce(a.series_id,scoped.id)
left join lateral (select version from public.article_versions v where v.article_id=a.id order by version desc limit 1) v on true
where (select public.is_owner());

create or replace function public.prepare_starter_content(p_hash text,p_html text,p_articles jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare job public.starter_imports%rowtype; parent public.series%rowtype; page public.custom_pages%rowtype;
 item public.articles%rowtype; descriptor jsonb; objects jsonb:='[]'::jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('starter-content-v1',0));
 select * into job from public.starter_imports where id='getting-started-v1';
 if found then
   if job.template_hash<>p_hash then raise exception 'STARTER_TEMPLATE_CHANGED'; end if;
   return to_jsonb(job)-'objects';
 end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_html is null or length(p_html)>100000
   or coalesce(jsonb_typeof(p_articles),'')<>'array' or jsonb_array_length(p_articles)<>8 then raise exception 'INVALID_STARTER_TEMPLATE'; end if;
 if exists(select 1 from public.publish_requests where client_request_id ~ '^starter_v1_[0-7]$')
   or exists(select 1 from public.series where slug='getting-started') or exists(select 1 from public.custom_pages where slug='pricing')
   or exists(select 1 from public.articles where slug in(select value->>'slug' from jsonb_array_elements(p_articles)))
   or exists(select 1 from public.content_files where article_slug in(select value->>'slug' from jsonb_array_elements(p_articles))) then raise exception 'STARTER_SLUG_CONFLICT'; end if;
 insert into public.series(slug,type,title,task,price,status,nav_enabled,nav_label,nav_order)
 values('getting-started','handbook','使用指南','从部署到发布，了解本站系统的配置与日常使用。',0,'draft',false,'使用指南',100) returning * into parent;
 insert into public.custom_pages(slug,title,description,html,status,placement,nav_label,nav_order)
 values('pricing','收费方案','了解阅读、订阅、内容购买与服务合作。',p_html,'draft','none','收费方案',90) returning * into page;
 for descriptor in select value from jsonb_array_elements(p_articles) loop
   if descriptor->>'slug' is null or descriptor->>'slug' !~ '^[a-z0-9][a-z0-9-]{1,119}$'
     or coalesce(length(descriptor->>'title'),0) not between 1 and 200
     or coalesce(descriptor->>'content_hash','') !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_STARTER_ARTICLE'; end if;
   insert into public.articles(slug,series_id,type,title,access,status,sort_order)
   values(descriptor->>'slug',parent.id,'chapter',descriptor->>'title','public','draft',jsonb_array_length(objects)) returning * into item;
   objects:=objects||jsonb_build_array(jsonb_build_object('id',item.id,'slug',item.slug,'updated_at',item.updated_at,'content_hash',descriptor->>'content_hash'));
 end loop;
 insert into public.starter_imports(id,template_hash,objects) values('getting-started-v1',p_hash,
   jsonb_build_object('series_id',parent.id,'series_updated_at',parent.updated_at,'page_id',page.id,'page_updated_at',page.updated_at,'articles',objects)) returning * into job;
 return to_jsonb(job)-'objects';
end $$;
revoke all on function public.prepare_starter_content(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_starter_content(text,text,jsonb) to service_role;


-- Restrictive policy survives an unrelated permissive Storage policy.
-- Signed capabilities are issued by the trusted server; API roles cannot list/read/write this bucket directly.
do $$ begin
 if to_regclass('storage.objects') is not null then
   execute 'create policy skill_packages_private on storage.objects as restrictive for all to anon,authenticated using (bucket_id <> ''skill-packages'') with check (bucket_id <> ''skill-packages'')';
 end if;
end $$;

-- A migrated skill and its retained legacy chapters share lifecycle, never transaction IDs.
create function public.sync_legacy_skill_lifecycle() returns trigger language plpgsql set search_path='' as $$
declare target bigint;
begin
 if new.status is not distinct from old.status then return new; end if;
 if tg_table_name='articles' and new.type='skill' then
   select legacy_series_id into target from public.skills where id=new.id;
   if target is not null then update public.series set status=new.status,paused_at=new.paused_at where id=target and status<>new.status; end if;
 elsif tg_table_name='series' and new.type='skill' then
   select id into target from public.skills where legacy_series_id=new.id;
   if target is not null then update public.articles set status=new.status,paused_at=new.paused_at where id=target and status<>new.status; end if;
 end if;
 return new;
end $$;
revoke all on function public.sync_legacy_skill_lifecycle() from public,anon,authenticated,service_role;
create trigger sync_legacy_skill_lifecycle after update of status on public.articles for each row execute function public.sync_legacy_skill_lifecycle();
create trigger sync_legacy_skill_lifecycle after update of status on public.series for each row execute function public.sync_legacy_skill_lifecycle();

-- Confirmations cannot commit after expiry. A one-hour grace also excludes in-flight uploads.
alter table public.skill_uploads add column cleaned_at timestamptz;
create function public.expired_skill_uploads(p_owner uuid,p_skill bigint) returns setof public.skill_uploads
language sql stable set search_path='' as $$
 select u.* from public.skill_uploads u where u.owner_id=p_owner and u.skill_id=p_skill
 and exists(select 1 from public.profiles where id=p_owner and is_owner)
 and u.release_id is null and u.cleaned_at is null and u.expires_at<now()-interval '1 hour'
 and (u.confirming_until is null or u.confirming_until<now()-interval '1 hour')
 and not exists(select 1 from public.skill_releases r where r.id=u.id)
 order by u.expires_at,u.id limit 10
$$;
revoke all on function public.expired_skill_uploads(uuid,bigint) from public,anon,authenticated;
grant execute on function public.expired_skill_uploads(uuid,bigint) to service_role;

update public.app_schema_version set version='20261024131326' where id=1;
notify pgrst,'reload schema';

-- Source migration: 20261026184628_series_review_workflow.sql

-- Owner settings are one optimistic transaction. Publication remains a separate explicit action.
create function public.save_series_settings(p_id bigint, p_expected timestamptz, p_values jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.series%rowtype; readme bigint;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 select * into s from public.series where id=p_id for update;
 if s.id is null or s.status='archived' or s.updated_at is distinct from p_expected then
   return jsonb_build_object('ok',false,'message','专辑已更新或归档，请刷新后重新核对。');
 end if;
 if jsonb_typeof(p_values)<>'object' or length(trim(p_values->>'title')) not between 1 and 200
   or length(coalesce(p_values->>'task',''))>300 or length(coalesce(p_values->>'nav_label',''))>80
   or abs((p_values->>'nav_order')::int)>10000
   or jsonb_typeof(p_values->'tags')<>'array' or jsonb_array_length(p_values->'tags')>20
   or jsonb_typeof(p_values->'audiences')<>'array' or jsonb_array_length(p_values->'audiences')>20
   or exists(select 1 from jsonb_array_elements(p_values->'tags'||p_values->'audiences') x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>50)
   or (s.type<>'event' and (p_values->>'price' !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$')) then raise exception 'INVALID_SETTINGS'; end if;
 readme:=nullif(p_values->>'readme_article_id','')::bigint;
 if readme is not null and not exists(select 1 from public.articles where id=readme and series_id=s.id and access='public' and status in ('published','paused')) then
   return jsonb_build_object('ok',false,'message','README 必须是本专辑已发布的公开章节。');
 end if;
 if s.status<>'draft' and readme is null then return jsonb_build_object('ok',false,'message','已上架专辑需要保留公开 README。'); end if;
 update public.series set title=trim(p_values->>'title'),task=nullif(p_values->>'task',''),
 tags=array(select jsonb_array_elements_text(p_values->'tags')),audiences=array(select jsonb_array_elements_text(p_values->'audiences')),
 nav_enabled=(p_values->>'nav_enabled')::boolean,nav_label=nullif(p_values->>'nav_label',''),nav_order=(p_values->>'nav_order')::int,
 featured=(p_values->>'featured')::boolean,price=case when s.type='event' then s.price else (p_values->>'price')::numeric end,
 readme_article_id=readme where id=s.id;
 return jsonb_build_object('ok',true,'message','专辑设置已保存；正文和上架状态未改变。');
end $$;
revoke all on function public.save_series_settings(bigint,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_series_settings(bigint,timestamptz,jsonb) to authenticated;

create function public.series_pending_revisions(p_id bigint)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
 with pending as (
 select r.id,r.version,f.path,f.article_slug slug,r.snapshot->'frontmatter'->>'title' title,
 r.snapshot->'frontmatter'->>'access' access
 from public.series s join public.content_files f on f.scope='series:'||s.slug
 join public.content_file_heads h on h.file_id=f.id join public.content_file_revisions r on r.id=h.id
 where s.id=p_id and r.publication is null
 ) select jsonb_build_object('total',(select count(*) from pending),'items',coalesce((select jsonb_agg(t order by t.path,t.id) from (select * from pending order by path,id limit 500) t),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.series_pending_revisions(bigint) from public,anon,authenticated,service_role;
grant execute on function public.series_pending_revisions(bigint) to authenticated;

-- Prepared payloads come only from the shared server publication validator. All selected chapters
-- commit together; an exception rolls back earlier chapters and their idempotency receipts.
create function public.commit_series_publication(p_series bigint,p_expected timestamptz,p_request uuid,p_items jsonb,p_activate boolean,p_readme text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' set statement_timeout='25s' as $$
declare s public.series%rowtype; r public.content_file_revisions%rowtype; f public.content_files%rowtype;
 item jsonb; result jsonb; results jsonb:='[]'; signature text; request_key text; current_updated timestamptz; readme_id bigint;
begin
 if p_request is null or p_activate is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 500
   or octet_length(p_items::text)>8388608 then raise exception 'BATCH_INVALID'; end if;
 if (select count(distinct (x->>'id')::bigint) from jsonb_array_elements(p_items) x)<>jsonb_array_length(p_items) then raise exception 'BATCH_INVALID'; end if;
 signature:=md5(jsonb_build_object('series',p_series,'expected',p_expected,'activate',p_activate,'readme',p_readme,'ids',(select jsonb_agg((x->>'id')::bigint order by (x->>'id')::bigint) from jsonb_array_elements(p_items) x))::text);
 request_key:='series-batch:'||p_request;
 perform pg_catalog.pg_advisory_xact_lock(71001,pg_catalog.hashtext(request_key));
 select response into result from public.publish_requests where client_request_id=request_key;
 if found then
   if result->>'batch_signature' is distinct from signature then raise exception 'BATCH_REPLAY_CHANGED'; end if;
   return result;
 end if;
 -- Match individual publication's revision -> file -> request -> article lock order.
 for item in select x from jsonb_array_elements(p_items) x order by (x->>'id')::bigint loop
   select * into r from public.content_file_revisions where id=(item->>'id')::bigint for update;
   if not found then raise exception 'BATCH_REVISION_MISSING'; end if;
   select * into f from public.content_files where id=r.file_id for update;
   perform pg_catalog.pg_advisory_xact_lock(71001,pg_catalog.hashtext(r.request_id));
   perform pg_catalog.pg_advisory_xact_lock(71002,pg_catalog.hashtext(f.article_slug));
 end loop;
 select * into s from public.series where id=p_series for update;
 if s.id is null or s.status='archived' or s.updated_at is distinct from p_expected then raise exception 'BATCH_SERIES_CHANGED'; end if;
 if p_activate and s.status<>'draft' then raise exception 'BATCH_ACTIVATION_INVALID'; end if;
 for item in select x from jsonb_array_elements(p_items) x order by (x->>'id')::bigint loop
   select * into r from public.content_file_revisions where id=(item->>'id')::bigint;
   select * into f from public.content_files where id=r.file_id;
   if f.scope<>'series:'||s.slug or r.snapshot is distinct from item->'payload'->'snapshot'
     or item->'payload'->'frontmatter' is distinct from r.snapshot->'frontmatter'
     or r.snapshot->'frontmatter'->>'series_slug' is distinct from s.slug
     or r.snapshot->'frontmatter'->>'slug' is distinct from f.article_slug
     or r.snapshot->'frontmatter'->>'type' is distinct from 'chapter' then raise exception 'BATCH_SCOPE_CHANGED'; end if;
   if exists(select 1 from public.content_file_revisions where file_id=f.id and version>r.version) then raise exception 'BATCH_REVISION_CHANGED'; end if;
   select updated_at into current_updated from public.articles where slug=f.article_slug;
   if current_updated is distinct from coalesce(r.published_updated_at,r.base_updated_at) then raise exception 'BATCH_ONLINE_CHANGED'; end if;
   result:=public.commit_file_publication(r.id,item->'payload');
   if result->>'status'='blocked' then raise exception 'BATCH_PUBLICATION_BLOCKED'; end if;
   results:=results||jsonb_build_array(result);
 end loop;
 if p_readme is not null then
   select id into readme_id from public.articles where series_id=s.id and slug=p_readme and access='public' and status in ('published','paused');
   if readme_id is null then raise exception 'BATCH_README_INVALID'; end if;
   update public.series set readme_article_id=readme_id where id=s.id and readme_article_id is distinct from readme_id;
 end if;
 if p_activate then
   select updated_at into current_updated from public.series where id=s.id;
   -- The service role is deliberately not an owner; enforce the same activation invariants here.
   if not exists(select 1 from public.series a join public.articles b on b.id=a.readme_article_id where a.id=s.id and b.series_id=s.id and b.access='public' and b.status in ('published','paused'))
     or (s.type='event' and not exists(select 1 from public.event_details where series_id=s.id)) then raise exception 'BATCH_README_OR_EVENT_REQUIRED'; end if;
   update public.series set status='published',paused_at=null where id=s.id;
 end if;
 result:=jsonb_build_object('status','pass','article',null,'diagnostics','[]'::jsonb,'revalidated','[]'::jsonb,'results',results,'batch_signature',signature,'activated',p_activate);
 insert into public.publish_requests(client_request_id,status,response) values(request_key,'pass',result);
 return result;
end $$;
revoke all on function public.commit_series_publication(bigint,timestamptz,uuid,jsonb,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.commit_series_publication(bigint,timestamptz,uuid,jsonb,boolean,text) to service_role;
update public.app_schema_version set version='20261026184628' where id=1;
notify pgrst,'reload schema';


commit;
