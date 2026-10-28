-- Operator-only recovery operation, NOT an application schema migration.
-- Run inside an explicit transaction after setting LOCAL wanyou.media_relocation
-- to {"source_url":...,"article_slug":...}. The caller must verify the isolated
-- target connection, private backup, and destination object bytes before running.
-- Default rehearsal must ROLLBACK. See docs/legacy-media-relocation.md.
set local lock_timeout = '2s';
set local statement_timeout = '8s';
set local idle_in_transaction_session_timeout = '15s';
create temporary table media_relocation_before(table_name text, row_data jsonb) on commit drop;

do $relocate$
declare
  config jsonb := nullif(current_setting('wanyou.media_relocation', true), '')::jsonb;
  old_url text := config->>'source_url';
  article_slug text := config->>'article_slug';
  parts text[];
  new_url text;
  source_origin text;
  article_key bigint;
  rel record;
  field record;
  occurrences bigint;
  expected jsonb;
  actual jsonb;
begin
  parts := regexp_match(old_url, '^https://([a-z0-9]{20})\.supabase\.co/storage/v1/object/public/([a-z0-9_-]+)/media/([a-z0-9]+(?:-[a-z0-9]+)*)/([a-f0-9]{64}\.(?:png|jpg|webp|gif))$');
  if parts is null or article_slug is null or article_slug <> parts[3] or length(article_slug) not between 2 and 120 then
    raise exception 'MEDIA_RELOCATION_INVALID_MAPPING';
  end if;
  if current_user in ('anon', 'authenticated', 'service_role') then
    raise exception 'MEDIA_RELOCATION_DATABASE_OPERATOR_REQUIRED';
  end if;
  if not exists(select 1 from public.app_schema_version where id=1 and version='20260929134545') then
    raise exception 'MEDIA_RELOCATION_UNREVIEWED_SCHEMA';
  end if;
  new_url := '/media/' || article_slug || '/' || parts[4];
  source_origin := 'https://' || parts[1] || '.supabase.co';
  if (select count(*) from storage.objects where bucket_id=parts[2] and name='media/'||article_slug||'/'||parts[4]) <> 1 then
    raise exception 'MEDIA_RELOCATION_OBJECT_MISSING';
  end if;

  -- Short isolated maintenance window: readers remain allowed, concurrent app
  -- writers must wait. Snapshot every public table to detect trigger side effects.
  for rel in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('lock table public.%I in share row exclusive mode', rel.tablename);
    execute format('insert into pg_temp.media_relocation_before select %L, to_jsonb(t) from public.%I t', rel.tablename, rel.tablename);
  end loop;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
    join pg_namespace pn on pn.oid=p.pronamespace
    where n.nspname='public' and c.relname in ('articles','article_bodies','article_chunks') and not t.tgisinternal
      and (pn.nspname<>'public' or t.tgenabled<>'O' or (c.relname,t.tgname,p.proname) not in
        (('articles','trg_articles_updated','set_updated_at'),('articles','guard_content_lifecycle','guard_content_lifecycle')))) then
    raise exception 'MEDIA_RELOCATION_UNREVIEWED_TRIGGER';
  end if;
  select id into article_key from public.articles where articles.slug=article_slug;
  if article_key is null then raise exception 'MEDIA_RELOCATION_ARTICLE_MISSING'; end if;
  if (select cover_url from public.articles where id=article_key) is distinct from old_url then
    raise exception 'MEDIA_RELOCATION_COVER_MISMATCH';
  end if;

  -- This reviewed operation intentionally accepts one article / one image only.
  -- Unknown source links, extra occurrences and reruns fail before any UPDATE.
  for field in select * from (values
    ('articles','cover_url','id'), ('articles','preview_md','id'),
    ('article_bodies','content','article_id'), ('article_chunks','content','article_id')
  ) as f(table_name,column_name,key_name) loop
    execute format('select coalesce(sum((length(%1$I)-length(replace(%1$I,$1,'''')))/length($1)),0) from public.%2$I where %3$I=$2', field.column_name,field.table_name,field.key_name)
      into occurrences using old_url, article_key;
    if occurrences <> 1 then raise exception 'MEDIA_RELOCATION_UNEXPECTED_COUNT: %.%', field.table_name,field.column_name; end if;
    execute format('select count(*) from public.%I where position($1 in coalesce(%I,''''))>0 and (%I<>$2 or position($1 in replace(%I,$3,''''))>0)',field.table_name,field.column_name,field.key_name,field.column_name)
      into occurrences using source_origin,article_key,old_url;
    if occurrences <> 0 then raise exception 'MEDIA_RELOCATION_UNMAPPED_URL'; end if;
    execute format('select count(*) from public.%I where position($1 in %I)>0 and not (left(split_part(%I,$1,2),1)=any(array['''','' '',chr(10),chr(13),chr(9),'')'','']'',''"'',chr(39),''>'',''<'']))',field.table_name,field.column_name,field.column_name)
      into occurrences using old_url;
    if occurrences <> 0 then raise exception 'MEDIA_RELOCATION_URL_SUFFIX_REVIEW_REQUIRED'; end if;
  end loop;
  if exists(select 1 from public.article_chunks where article_id=article_key and position(old_url in content)>0 and embedding is not null) then
    raise exception 'MEDIA_RELOCATION_EMBEDDING_REVIEW_REQUIRED';
  end if;

  update public.articles set cover_url=new_url,preview_md=replace(preview_md,old_url,new_url) where id=article_key;
  update public.article_bodies set content=replace(content,old_url,new_url) where article_id=article_key and position(old_url in content)>0;
  update public.article_chunks set content=replace(content,old_url,new_url) where article_id=article_key and position(old_url in content)>0;

  -- Build the only permitted after-state from the before-state. Preserve all
  -- historical rows, hashes, ACL-facing fields, embeddings, commerce and queues.
  -- The article updated_at trigger is deliberately allowed to run normally.
  update pg_temp.media_relocation_before set row_data=
    jsonb_set(jsonb_set(row_data-'updated_at','{cover_url}',to_jsonb(new_url)),
      '{preview_md}',to_jsonb(replace(row_data->>'preview_md',old_url,new_url)))
    where table_name='articles' and (row_data->>'id')::bigint=article_key;
  update pg_temp.media_relocation_before set row_data=jsonb_set(row_data,'{content}',to_jsonb(replace(row_data->>'content',old_url,new_url)))
    where table_name in ('article_bodies','article_chunks') and (row_data->>'article_id')::bigint=article_key;
  for rel in select tablename from pg_tables where schemaname='public' order by tablename loop
    select coalesce(jsonb_agg(row_data order by row_data::text),'[]'::jsonb) into expected
      from pg_temp.media_relocation_before where table_name=rel.tablename;
    if rel.tablename='articles' then
      select coalesce(jsonb_agg(j order by j::text),'[]'::jsonb) into actual from
        (select case when id=article_key then to_jsonb(a)-'updated_at' else to_jsonb(a) end j from public.articles a) s;
    else
      execute format('select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb) from public.%I t',rel.tablename) into actual;
    end if;
    if expected is distinct from actual then raise exception 'MEDIA_RELOCATION_INVARIANT_FAILED: %',rel.tablename; end if;
  end loop;
  if exists(select 1 from public.articles where position(source_origin in coalesce(cover_url,'')||preview_md)>0)
    or exists(select 1 from public.article_bodies where position(source_origin in content)>0)
    or exists(select 1 from public.article_chunks where position(source_origin in content)>0) then
    raise exception 'MEDIA_RELOCATION_SOURCE_REFERENCE_REMAINS';
  end if;
end
$relocate$;
