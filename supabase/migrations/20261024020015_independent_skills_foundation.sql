begin;
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
commit;
