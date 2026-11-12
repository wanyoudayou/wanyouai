begin;
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
commit;
