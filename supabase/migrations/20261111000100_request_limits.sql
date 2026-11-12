begin;
-- Daily request limits for public write endpoints (escalation, inquiry).
-- One row per bucket and site-local day; the increment is a single atomic upsert.
create table public.request_limits (
  bucket text not null,
  day date not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, day),
  constraint request_limits_bucket_check check (length(bucket) between 1 and 200),
  constraint request_limits_used_check check (used >= 0)
);
alter table public.request_limits enable row level security;
revoke all on table public.request_limits from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.request_limits to service_role;

create function public.consume_request_limit(p_bucket text, p_day date, p_limit integer)
returns boolean language plpgsql set search_path='' as $$
declare v_used integer;
begin
  if p_bucket is null or length(p_bucket) not between 1 and 200 or p_day is null or p_limit is null or p_limit < 1 then
    raise exception 'INVALID_LIMIT';
  end if;
  insert into public.request_limits(bucket, day, used) values (p_bucket, p_day, 1)
  on conflict (bucket, day) do update set used = public.request_limits.used + 1, updated_at = now()
    where public.request_limits.used < p_limit
  returning used into v_used;
  -- Old windows are not needed for decisions; keep the table bounded.
  delete from public.request_limits where day < p_day - 7;
  return v_used is not null;
end $$;
revoke all on function public.consume_request_limit(text, date, integer) from public, anon, authenticated, service_role;
grant execute on function public.consume_request_limit(text, date, integer) to service_role;

-- A service inquiry and its owner inbox item commit together or not at all.
create function public.submit_service_inquiry(
  p_service_slug text, p_user uuid, p_email text, p_intent text,
  p_budget text, p_deadline date, p_links text[], p_ip text)
returns jsonb language plpgsql set search_path='' as $$
declare v_service public.services%rowtype; v_booking bigint;
begin
  if p_email is null or length(p_email) not between 3 and 320 or p_intent is null or length(p_intent) not between 10 and 2000
    or length(coalesce(p_budget,'')) > 120 or coalesce(array_length(p_links,1),0) > 5 or length(coalesce(p_ip,'')) > 100 then
    raise exception 'INVALID_INQUIRY';
  end if;
  select * into v_service from public.services where slug=p_service_slug and status='published' for share;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  insert into public.bookings(service_id,user_id,email,intent,budget_range,deadline,context_links,status)
  values(v_service.id,p_user,p_email,p_intent,nullif(p_budget,''),p_deadline,coalesce(p_links,'{}'),'inquiry')
  returning id into v_booking;
  insert into public.inbox_items(kind,user_id,contact,payload)
  values('inquiry',p_user,p_email,jsonb_build_object('message',p_intent,'service',v_service.title,'slug',v_service.slug,
    'budget_range',nullif(p_budget,''),'deadline',p_deadline,'ip',coalesce(p_ip,'unknown'),'booking_id',v_booking));
  return jsonb_build_object('ok',true,'booking_id',v_booking,'service_title',v_service.title);
end $$;
revoke all on function public.submit_service_inquiry(text,uuid,text,text,text,date,text[],text) from public,anon,authenticated,service_role;
grant execute on function public.submit_service_inquiry(text,uuid,text,text,text,date,text[],text) to service_role;

update public.app_schema_version set version='20261111000100' where id=1;
notify pgrst,'reload schema';
commit;
