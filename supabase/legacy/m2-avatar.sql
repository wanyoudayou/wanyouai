-- Additive M2-S1 avatar retrieval. Apply after m1-takedown.sql.
-- 全域检索走 service_role（绕过 RLS）；注入分级在应用层按读者身份裁决（见 src/lib/avatar/retrieve.ts）。

create or replace function public.match_chunks(p_embedding vector(1024), p_limit integer default 12)
returns table (chunk_id bigint, article_id bigint, series_id bigint, access text, chunk_type text, chunk_no integer, content text, distance float)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.article_id, c.series_id, c.access, c.chunk_type, c.chunk_no, c.content,
         (c.embedding operator(public.<=>) p_embedding)::float
  from public.article_chunks c
  join public.articles a on a.id = c.article_id
  where c.embedding is not null and a.status in ('published', 'paused')
  order by c.embedding operator(public.<=>) p_embedding
  limit greatest(1, least(coalesce(p_limit, 12), 24))
$$;

revoke all on function public.match_chunks(vector, integer) from public, anon, authenticated;
grant execute on function public.match_chunks(vector, integer) to service_role;
