begin;
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
commit;
