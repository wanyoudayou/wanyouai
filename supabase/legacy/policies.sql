-- 万有AI RLS policies. Run after schema.sql on a clean project.
-- Service-role server functions bypass RLS; they remain the only write path
-- for article bodies, versions, entitlements, orders, and payment events.

create or replace function is_owner() returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and is_owner
  );
$$;

create or replace function claim_owner() returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return false;
  end if;

  -- Serialize the one-time owner claim across concurrent transactions.
  perform pg_advisory_xact_lock(793710621);

  if exists (select 1 from profiles where is_owner) then
    return false;
  end if;

  insert into profiles (id, is_owner) values (auth.uid(), true)
  on conflict (id) do update
    set is_owner = true, created_at = profiles.created_at
  where profiles.is_owner = false;

  return true;
end;
$$;

revoke all on function claim_owner() from public;
grant execute on function claim_owner() to authenticated;
grant execute on function is_owner() to public;

-- Profiles -------------------------------------------------------------------
create policy profiles_owner_read on profiles for select
  using (is_owner());
create policy profiles_self_read on profiles for select
  using (id = auth.uid());

-- Site configuration ----------------------------------------------------------
create policy site_config_read on site_config for select using (true);
create policy site_config_owner_update on site_config for update
  using (is_owner()) with check (is_owner());

create policy site_secrets_owner_all on site_secrets for all
  using (is_owner()) with check (is_owner());

-- Public metadata -------------------------------------------------------------
create policy series_read on series for select
  using (is_owner() or status in ('published', 'paused'));
create policy series_owner_insert on series for insert
  with check (is_owner());
create policy series_owner_update on series for update
  using (is_owner()) with check (is_owner());

create policy articles_read on articles for select
  using (is_owner() or status in ('published', 'paused'));
create policy articles_owner_update on articles for update
  using (is_owner()) with check (is_owner());

create policy event_details_read on event_details for select
  using (
    is_owner() or exists (
      select 1 from series s
      where s.id = event_details.series_id
        and s.status in ('published', 'paused')
    )
  );
create policy event_details_owner_write on event_details for all
  using (is_owner()) with check (is_owner());

create policy skill_details_read on skill_details for select
  using (
    is_owner() or exists (
      select 1 from series s
      where s.id = skill_details.series_id
        and s.status in ('published', 'paused')
    )
  );

create policy services_read on services for select
  using (is_owner() or status in ('published', 'paused'));
create policy services_owner_write on services for all
  using (is_owner()) with check (is_owner());

-- Article body hard gate ------------------------------------------------------
create policy bodies_read on article_bodies for select
  using (
    is_owner() or exists (
      select 1 from articles a
      where a.id = article_bodies.article_id
        and a.status in ('published', 'paused')
        and (
          exists (
            select 1 from series s
            where s.readme_article_id = a.id
              and s.status in ('published', 'paused')
          )
          or a.access = 'public'
          or (a.access = 'registered' and auth.uid() is not null)
          or (
            a.access = 'subscriber'
            and auth.uid() is not null
            and exists (
              select 1 from entitlements e
              where e.user_id = auth.uid()
                and e.revoked_at is null
                and (e.ends_at is null or e.ends_at > now())
                and (
                  e.type = 'subscription'
                  or (e.type = 'event' and e.target_id = a.series_id)
                )
            )
          )
          or (
            a.access = 'paid'
            and auth.uid() is not null
            and exists (
              select 1 from entitlements e
              where e.user_id = auth.uid()
                and e.revoked_at is null
                and (e.ends_at is null or e.ends_at > now())
                and (
                  e.type = 'subscription'
                  or (e.type = 'series' and e.target_id = a.series_id)
                  or (e.type = 'single' and e.target_id = a.id)
                )
            )
          )
        )
    )
  );

create policy versions_owner_read on article_versions for select
  using (is_owner());

-- Client-side direct query fallback for chunks --------------------------------
create policy chunks_read on article_chunks for select
  using (
    is_owner() or exists (
      select 1 from articles a
      where a.id = article_chunks.article_id
        and a.status in ('published', 'paused')
        and (
          article_chunks.chunk_type in ('catalog', 'readme', 'preview')
          or a.access = 'public'
          or (a.access = 'registered' and auth.uid() is not null)
          or (
            a.access = 'subscriber'
            and auth.uid() is not null
            and exists (
              select 1 from entitlements e
              where e.user_id = auth.uid()
                and e.revoked_at is null
                and (e.ends_at is null or e.ends_at > now())
                and (
                  e.type = 'subscription'
                  or (e.type = 'event' and e.target_id = a.series_id)
                )
            )
          )
          or (
            a.access = 'paid'
            and auth.uid() is not null
            and exists (
              select 1 from entitlements e
              where e.user_id = auth.uid()
                and e.revoked_at is null
                and (e.ends_at is null or e.ends_at > now())
                and (
                  e.type = 'subscription'
                  or (e.type = 'series' and e.target_id = a.series_id)
                  or (e.type = 'single' and e.target_id = a.id)
                )
            )
          )
        )
    )
  );

-- Commerce --------------------------------------------------------------------
create policy entitlements_own_read on entitlements for select
  using (user_id = auth.uid() or is_owner());

create policy orders_own_read on orders for select
  using (user_id = auth.uid() or is_owner());
-- Orders are created only by the payment server function. Clients must not be
-- allowed to choose arbitrary amounts or SKU targets.

create policy payment_events_owner_read on payment_events for select
  using (is_owner());
-- payment_events inserts/updates are reserved to service-role callbacks.

-- Service delivery and events -------------------------------------------------
create policy bookings_own_read on bookings for select
  using (user_id = auth.uid() or is_owner());

create policy milestones_read on milestones for select
  using (exists (
    select 1 from bookings b
    where b.id = milestones.booking_id
      and (b.user_id = auth.uid() or is_owner())
  ));

create policy registrations_own_read on registrations for select
  using (user_id = auth.uid() or is_owner());

create policy evaluations_public_read on evaluations for select using (true);
create policy reviews_public_read on article_reviews for select using (true);

create policy publish_requests_owner_read on publish_requests for select
  using (is_owner());

-- Public avatar conversations ---------------------------------------------------
create policy conversations_own_read on conversations for select
  using (user_id = auth.uid() or is_owner() or status = 'public');
create policy conversations_own_insert on conversations for insert
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and (
      article_id is null
      or exists (
        select 1 from articles a
        where a.id = conversations.article_id
          and a.status in ('published', 'paused')
      )
    )
  );

create policy conversation_messages_read on conversation_messages for select
  using (
    exists (
      select 1 from conversations c
      where c.id = conversation_messages.conversation_id
        and (c.user_id = auth.uid() or is_owner() or c.status = 'public')
    )
  );
create policy conversation_messages_own_insert on conversation_messages for insert
  with check (
    role = 'user'
    and exists (
      select 1 from conversations c
      where c.id = conversation_messages.conversation_id
        and c.user_id = auth.uid()
        and c.status in ('pending', 'public')
    )
  );

-- ---------------------------------------------------------------------------
-- Explicit Data API grants. These grants assume the Supabase security setting
-- "Automatically expose new tables" is DISABLED. Table grants never bypass RLS;
-- RLS remains the row-level hard gate.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;

-- Server-side authoritative path. Never expose this role or its key to a browser.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Read-only anonymous access. RLS hides draft/archived rows and gated bodies.
-- anon must be able to reference entitlements in RLS predicates; RLS returns no
-- rows to anon because it has no SELECT policy on entitlements.
grant select on entitlements to anon;
grant select on
  site_config,
  series,
  articles,
  article_bodies,
  article_chunks,
  event_details,
  skill_details,
  services,
  evaluations,
  article_reviews,
  conversations,
  conversation_messages
to anon;

-- Authenticated reads. RLS limits each user to own/entitled/public rows.
grant select on
  profiles,
  site_config,
  site_secrets,
  series,
  articles,
  article_bodies,
  article_versions,
  article_chunks,
  entitlements,
  orders,
  payment_events,
  event_details,
  registrations,
  skill_details,
  services,
  bookings,
  milestones,
  evaluations,
  article_reviews,
  conversations,
  conversation_messages,
  publish_requests
to authenticated;

-- Authenticated writes only where an RLS policy permits a user action.
grant update on site_config to authenticated;
grant insert, update on series to authenticated;
grant update on articles to authenticated;
grant select, insert, update, delete on services to authenticated;
grant select, insert, update, delete on event_details to authenticated;
grant select, insert, update, delete on site_secrets to authenticated;
grant insert on conversations to authenticated;
grant insert on conversation_messages to authenticated;

grant usage, select on sequence series_id_seq to authenticated;
grant usage, select on sequence services_id_seq to authenticated;
grant usage, select on sequence conversations_id_seq to authenticated;
grant usage, select on sequence conversation_messages_id_seq to authenticated;

-- Import bodies and path inventory are visible only to the owner.
create policy content_files_owner_read on content_files for select to authenticated using ((select public.is_owner()));
create policy content_revisions_owner_read on content_file_revisions for select to authenticated using ((select public.is_owner()));
create policy content_assets_owner_read on content_assets for select to authenticated using ((select public.is_owner()));
revoke all on content_files, content_file_revisions, content_assets from anon, authenticated;
grant select on content_files, content_file_revisions, content_assets to authenticated;
grant all on content_files, content_file_revisions, content_assets to service_role;
grant usage, select on sequence content_files_id_seq, content_file_revisions_id_seq to service_role;

grant select on content_file_heads to authenticated,service_role;
