-- Release baseline migration: maintenance source after adoption.

-- Complete application structure, neutral singleton and application version.

-- Unreleased candidate. Existing instances use the dedicated reviewed upgrade.

begin;

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

commit;
