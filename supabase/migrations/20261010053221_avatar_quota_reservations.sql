begin;
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
commit;
