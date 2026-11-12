begin;
-- Narrow, caller-scoped entrypoints so ordinary pages and user actions no longer
-- need service_role. Each returns only the fields its caller may see.

-- Public, transaction-anchored service reviews: no booking or personal fields.
create function public.public_service_evaluations(p_service bigint, p_limit integer default 20)
returns table(id bigint, rating integer, content text, created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select e.id, e.rating, e.content, e.created_at
  from public.evaluations e
  join public.bookings b on b.id = e.booking_id
  join public.services s on s.id = b.service_id
  where b.service_id = p_service and b.status = 'settled' and s.status = 'published'
  order by e.created_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke all on function public.public_service_evaluations(bigint, integer) from public, anon, authenticated, service_role;
grant execute on function public.public_service_evaluations(bigint, integer) to anon, authenticated, service_role;

-- Only the client of a settled booking may leave its single, append-only review.
create function public.submit_evaluation(p_booking bigint, p_rating integer, p_content text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid := auth.uid(); b public.bookings%rowtype;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'code', 'LOGIN_REQUIRED', 'message', '请登录后评价'); end if;
  if p_rating is null or p_rating not between 1 and 5 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', '请选择 1–5 星评分'); end if;
  select * into b from public.bookings where id = p_booking for share;
  if not found or b.user_id is distinct from v_user then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', '订单不存在'); end if;
  if b.status <> 'settled' then return jsonb_build_object('ok', false, 'code', 'NOT_SETTLED', 'message', '订单结案后才能评价'); end if;
  insert into public.evaluations(booking_id, rating, content)
  values (p_booking, p_rating, nullif(left(btrim(coalesce(p_content, '')), 2000), ''))
  on conflict (booking_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'code', 'DUPLICATE', 'message', '本订单已评价过，感谢你的反馈。'); end if;
  return jsonb_build_object('ok', true, 'message', '感谢评价，已展示在服务页。');
end $$;
revoke all on function public.submit_evaluation(bigint, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_evaluation(bigint, integer, text) to authenticated;

-- Check-in link view: anyone holding the token sees event title and status;
-- the registrant email is returned only to the owner.
create function public.checkin_lookup(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.registrations%rowtype; v_title text; v_owner boolean := public.is_owner();
begin
  if p_token is null then return jsonb_build_object('found', false); end if;
  select * into r from public.registrations where checkin_token = p_token;
  if not found then return jsonb_build_object('found', false); end if;
  select title into v_title from public.series where id = r.series_id;
  return jsonb_build_object('found', true, 'title', v_title, 'status', r.status, 'created_at', r.created_at,
    'is_self', r.user_id is not null and r.user_id = auth.uid(), 'has_account', r.user_id is not null)
    || case when v_owner then jsonb_build_object('email', r.email) else '{}'::jsonb end;
end $$;
revoke all on function public.checkin_lookup(uuid) from public, anon, authenticated, service_role;
grant execute on function public.checkin_lookup(uuid) to anon, authenticated;

update public.app_schema_version set version='20261111000200' where id=1;
notify pgrst,'reload schema';
commit;
