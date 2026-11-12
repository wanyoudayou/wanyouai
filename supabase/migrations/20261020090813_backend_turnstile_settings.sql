begin;
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
commit;
