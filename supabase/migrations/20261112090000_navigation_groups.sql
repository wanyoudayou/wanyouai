begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Two-level navigation: a `group` entry is a collapsible parent without its own
-- target; its children are ordinary entries (page, album, code section, link).
-- Only one level of nesting: a group is always top-level and children are never groups.
alter table public.nav_items add column parent_id bigint references public.nav_items(id) on delete cascade;
alter table public.nav_items drop constraint nav_items_kind_check;
alter table public.nav_items add constraint nav_items_kind_check
  check (kind in ('external','page','series','section','group'));
alter table public.nav_items drop constraint nav_items_target;
alter table public.nav_items add constraint nav_items_target check (
  (kind = 'external' and url is not null and page_id is null and series_id is null and section is null) or
  (kind = 'page' and page_id is not null and url is null and series_id is null and section is null) or
  (kind = 'series' and series_id is not null and url is null and page_id is null and section is null) or
  (kind = 'section' and section is not null and url is null and page_id is null and series_id is null) or
  (kind = 'group' and url is null and page_id is null and series_id is null and section is null));
alter table public.nav_items add constraint nav_items_group_top_level check (kind <> 'group' or parent_id is null);
create index nav_items_parent on public.nav_items(parent_id) where parent_id is not null;

-- A parent must be a top-level group; a group with children cannot change kind.
create function public.guard_nav_item_parent() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.parent_id is not null and not exists(
   select 1 from public.nav_items g where g.id = new.parent_id and g.kind = 'group' and g.parent_id is null) then
   raise exception 'NAV_PARENT_INVALID';
 end if;
 if tg_op = 'UPDATE' and old.kind = 'group' and new.kind <> 'group'
   and exists(select 1 from public.nav_items c where c.parent_id = new.id) then
   raise exception 'NAV_PARENT_INVALID';
 end if;
 return new;
end $$;
create trigger nav_item_parent before insert or update of parent_id, kind on public.nav_items
 for each row execute function public.guard_nav_item_parent();
revoke all on function public.guard_nav_item_parent() from public,anon,authenticated,service_role;

-- Public projection now carries the parent; children of a disabled group stay hidden.
-- Groups are returned when enabled; the application hides groups without visible children.
drop function public.public_navigation();
create function public.public_navigation()
returns table(id bigint, parent_id bigint, kind text, label text, icon text, url text, page_slug text,
  series_slug text, series_type text, section text, access text)
language sql stable security definer set search_path='' as $$
  select n.id, n.parent_id, n.kind, n.label, n.icon, n.url, p.slug, s.slug, s.type, n.section, n.access
  from public.nav_items n
  left join public.nav_items g on g.id = n.parent_id
  left join public.custom_pages p on p.id = n.page_id
  left join public.series s on s.id = n.series_id
  where n.enabled
    and (n.parent_id is null or g.enabled)
    and (n.kind <> 'page' or p.status = 'published')
    and (n.kind <> 'series' or s.status in ('published','paused'))
  order by n.sort_order, n.id
  limit 100
$$;
revoke all on function public.public_navigation() from public, anon, authenticated, service_role;
grant execute on function public.public_navigation() to anon, authenticated, service_role;

-- The saved list stays flat and ordered; `child: true` attaches an entry to the
-- nearest preceding group. A top-level entry ends the current group.
create or replace function public.save_nav_items(p_expected text, p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; position integer := 0; current_group bigint; inserted bigint; is_child boolean;
begin
  if not public.is_owner() then raise exception 'OWNER_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nav-items', 0));
  if public.nav_items_version() is distinct from p_expected then
    return jsonb_build_object('ok', false, 'message', '导航已被更新，请刷新后重新核对。');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50
    or exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) <> 'object') then
    raise exception 'INVALID_NAVIGATION';
  end if;
  delete from public.nav_items where true;
  for item in select value from jsonb_array_elements(p_items) loop
    is_child := coalesce((item->>'child')::boolean, false);
    if is_child and (current_group is null or item->>'kind' = 'group') then
      raise exception 'INVALID_NAVIGATION';
    end if;
    insert into public.nav_items(kind, label, icon, url, page_id, series_id, section, access, enabled, sort_order, parent_id)
    values (item->>'kind', btrim(item->>'label'), coalesce(item->>'icon', 'link'), nullif(item->>'url', ''),
      nullif(item->>'page_id', '')::bigint, nullif(item->>'series_id', '')::bigint, nullif(item->>'section', ''),
      coalesce(item->>'access', 'public'), coalesce((item->>'enabled')::boolean, true), position * 10,
      case when is_child then current_group end)
    returning id into inserted;
    if item->>'kind' = 'group' then current_group := inserted;
    elsif not is_child then current_group := null;
    end if;
    position := position + 1;
  end loop;
  return jsonb_build_object('ok', true, 'message', '导航已保存。', 'version', public.nav_items_version());
end $$;
revoke all on function public.save_nav_items(text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_nav_items(text, jsonb) to authenticated;

update public.app_schema_version set version='20261112090000' where id=1;
notify pgrst,'reload schema';
commit;
