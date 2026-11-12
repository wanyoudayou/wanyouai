-- Additive upgrade. Existing settle_payment remains compatible with old applications.
-- Only the queued entry point captures newly granted rights; historical payments are not backfilled.
begin;

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
commit;
