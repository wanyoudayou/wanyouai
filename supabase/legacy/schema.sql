-- 万有AI M0 physical schema
-- Target: Supabase Postgres. Run on a clean project before policies.sql and seed.sql.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Owner and site configuration
-- ---------------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text unique,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_owner_per_site on profiles (is_owner) where is_owner;

create table site_config (
  id integer primary key default 1 check (id = 1),
  site_name text not null,
  tagline text,
  owner_name text not null,
  footer_credit boolean not null default true,
  avatar_config jsonb not null default '{}'::jsonb,
  home_config jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  identity jsonb not null default '{}'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  commerce jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table site_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Content: series, articles, private bodies, versions, and RAG chunks
-- ---------------------------------------------------------------------------

create table series (
  id bigint generated always as identity primary key,
  slug text not null unique,
  type text not null default 'handbook'
    check (type in ('handbook', 'skill', 'event')),
  title text not null,
  readme_article_id bigint,
  price numeric(8, 2) not null default 0 check (price >= 0),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'paused', 'archived')),
  tags text[] not null default '{}',
  task text,
  audiences text[] not null default '{}',
  featured boolean not null default false,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_series_type_status on series (type, status, updated_at desc);

create table articles (
  id bigint generated always as identity primary key,
  slug text not null unique,
  series_id bigint references series(id),
  type text not null check (type in ('blog', 'chapter')),
  title text not null,
  summary text,
  cover_url text,
  tags text[] not null default '{}',
  access text not null default 'public'
    check (access in ('public', 'registered', 'subscriber', 'paid')),
  price numeric(8, 2),
  preview_md text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'paused', 'archived')),
  featured boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paused_at timestamptz,
  constraint article_container_check
    check ((type = 'blog' and series_id is null) or
           (type = 'chapter' and series_id is not null)),
  constraint article_price_check
    check ((type = 'blog' and access = 'paid' and price is not null and price > 0) or
           (type = 'blog' and access <> 'paid' and price is null) or
           (type = 'chapter' and price is null)),
  constraint article_publish_time_check
    check (status not in ('published', 'paused') or published_at is not null)
);
create index idx_articles_pub on articles (status, type, published_at desc);
create index idx_articles_series on articles (series_id);

alter table series
  add constraint fk_series_readme foreign key (readme_article_id) references articles(id);

create table article_bodies (
  article_id bigint primary key references articles(id) on delete cascade,
  content text not null
);

create table article_versions (
  id bigint generated always as identity primary key,
  article_id bigint not null references articles(id) on delete cascade,
  version integer not null check (version > 0),
  content_hash text not null,
  snapshot jsonb not null,
  client_request_id text,
  created_at timestamptz not null default now(),
  unique (article_id, version)
);
create unique index idx_versions_request
  on article_versions (client_request_id)
  where client_request_id is not null;

create table article_chunks (
  id bigint generated always as identity primary key,
  article_id bigint not null references articles(id) on delete cascade,
  series_id bigint references series(id),
  access text not null check (access in ('public', 'registered', 'subscriber', 'paid')),
  chunk_type text not null default 'body'
    check (chunk_type in ('catalog', 'readme', 'preview', 'body')),
  chunk_no integer not null check (chunk_no >= 0),
  content text not null,
  source_path text,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  unique (article_id, chunk_no)
);
create index idx_chunks_vec on article_chunks using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- Commerce: entitlements, orders, and payment inbox
-- ---------------------------------------------------------------------------

create table entitlements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('subscription', 'series', 'single', 'event')),
  target_id bigint,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  revoked_at timestamptz,
  source text not null default 'order'
    check (source in ('order', 'admin', 'checkin')),
  source_ref text,
  created_at timestamptz not null default now(),
  constraint entitlement_target_check
    check ((type = 'subscription' and target_id is null) or
           (type <> 'subscription' and target_id is not null))
);
create index idx_ent_user on entitlements (user_id) where revoked_at is null;

create table orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sku_type text not null check (sku_type in ('subscription', 'series', 'single', 'event')),
  target_id bigint,
  amount numeric(10, 2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'fulfilled', 'failed', 'refunded')),
  provider text not null default 'zpay' check (provider = 'zpay'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_target_check
    check ((sku_type = 'subscription' and target_id is null) or
           (sku_type <> 'subscription' and target_id is not null))
);

create table payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'zpay' check (provider = 'zpay'),
  event_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Events, skills, services, and delivery
-- ---------------------------------------------------------------------------

create table event_details (
  series_id bigint primary key references series(id) on delete cascade,
  starts_at timestamptz not null,
  location_text text,
  registration text,
  capacity text,
  kind text not null default 'open' check (kind in ('member', 'open')),
  ticket_price numeric(8, 2) check (ticket_price is null or ticket_price >= 0),
  state text not null default 'upcoming'
    check (state in ('upcoming', 'registering', 'ended'))
);

create table registrations (
  id bigint generated always as identity primary key,
  series_id bigint not null references series(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  status text not null default 'registered'
    check (status in ('registered', 'attended', 'cancelled')),
  checkin_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (series_id, email)
);

create table skill_details (
  series_id bigint primary key references series(id) on delete cascade,
  download_url text,
  file_manifest jsonb
);

create table services (
  id bigint generated always as identity primary key,
  slug text not null unique,
  title text not null,
  summary text,
  deliverables text[] not null default '{}',
  duration text,
  price numeric(10, 2) check (price is null or price >= 0),
  capacity_per_month integer check (capacity_per_month is null or capacity_per_month >= 0),
  protocol_snapshot jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'paused', 'archived')),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_service_has_price_check
    check (status <> 'published' or price is not null)
);

create table bookings (
  id bigint generated always as identity primary key,
  service_id bigint not null references services(id),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  intent text not null,
  budget_range text,
  deadline date,
  context_links text[],
  agreement_snapshot jsonb,
  agreed_at date,
  status text not null default 'inquiry'
    check (status in ('inquiry', 'quoted', 'booked', 'in_progress',
                      'delivered', 'accepted', 'settled', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table milestones (
  id bigint generated always as identity primary key,
  booking_id bigint not null references bookings(id) on delete cascade,
  title text not null,
  owner_party text not null default 'owner' check (owner_party in ('owner', 'client', 'third')),
  expected_at date,
  actual_at date,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_milestones_booking on milestones (booking_id);

create table evaluations (
  id bigint generated always as identity primary key,
  booking_id bigint not null unique references bookings(id),
  rating integer not null check (rating between 1 and 5),
  content text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Reviews and avatar conversations
-- ---------------------------------------------------------------------------

create table article_reviews (
  id bigint generated always as identity primary key,
  article_id bigint not null references articles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating integer check (rating is null or rating between 1 and 5),
  content text,
  images text[],
  created_at timestamptz not null default now()
);
create unique index idx_reviews_one_per_user on article_reviews (article_id, user_id)
  where rating is not null;

create table conversations (
  id bigint generated always as identity primary key,
  article_id bigint references articles(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_md text,
  status text not null default 'pending'
    check (status in ('pending', 'public', 'hidden')),
  created_at timestamptz not null default now()
);
create index idx_conv_article on conversations (article_id) where status = 'public';

create table conversation_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'avatar')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_conv_msgs on conversation_messages (conversation_id);

-- Publish idempotency inbox -------------------------------------------------
-- The server stores the first completed response for a client request id.
-- Replays return this response without creating another article version.

create table publish_requests (
  id uuid primary key default gen_random_uuid(),
  client_request_id text not null unique,
  status text not null check (status in ('pass', 'needs_user_action', 'blocked')),
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Updated-at maintenance and RLS enablement
-- ---------------------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_site_config_updated before update on site_config
  for each row execute function set_updated_at();
create trigger trg_series_updated before update on series
  for each row execute function set_updated_at();
create trigger trg_articles_updated before update on articles
  for each row execute function set_updated_at();
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();
create trigger trg_services_updated before update on services
  for each row execute function set_updated_at();
create trigger trg_bookings_updated before update on bookings
  for each row execute function set_updated_at();

alter table profiles enable row level security;
alter table site_config enable row level security;
alter table site_secrets enable row level security;
alter table series enable row level security;
alter table articles enable row level security;
alter table article_bodies enable row level security;
alter table article_versions enable row level security;
alter table article_chunks enable row level security;
alter table entitlements enable row level security;
alter table orders enable row level security;
alter table payment_events enable row level security;
alter table event_details enable row level security;
alter table registrations enable row level security;
alter table skill_details enable row level security;
alter table services enable row level security;
alter table bookings enable row level security;
alter table milestones enable row level security;
alter table evaluations enable row level security;
alter table article_reviews enable row level security;
alter table conversations enable row level security;
alter table conversation_messages enable row level security;
alter table publish_requests enable row level security;

-- Web imports: logical paths and immutable, owner-only pending revisions.
create table content_files (
  id bigint generated always as identity primary key,
  scope text not null,
  path text not null check (length(path) between 1 and 1024),
  article_slug text not null unique,
  sort integer not null default 0,
  unique(scope, path)
);
create table content_file_revisions (
  id bigint generated always as identity primary key,
  file_id bigint not null references content_files(id) on delete cascade,
  version integer not null check(version > 0),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null,
  base_updated_at timestamptz,
  request_id text not null unique,
  publication jsonb,
  published_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique(file_id, version)
);
create table content_assets (
  scope text not null,
  path text not null check (length(path) between 1 and 1024),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  media jsonb not null,
  updated_at timestamptz not null default now(),
  primary key(scope, path)
);
alter table content_files enable row level security;
alter table content_file_revisions enable row level security;
alter table content_assets enable row level security;

-- Reading order is independent of publication timestamps.
alter table articles add column sort_order integer not null default 0;
create view content_file_heads with (security_invoker = true) as
  select distinct on (file_id) id,file_id,version,input_hash,publication,created_at
  from content_file_revisions order by file_id,version desc;
