-- Run as postgres. No job or HTTP request is created.
-- Uses synchronous http, not pg_net's shared request queue.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists http with schema extensions;
do $check$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null
     or to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)') is null
     or to_regprocedure('extensions.http(extensions.http_request)') is null
     or to_regprocedure('extensions.http_set_curlopt(character varying,character varying)') is null
     or to_regprocedure('extensions.http_reset_curlopt()') is null then
    raise exception 'Required scheduler APIs missing; inspect extension schema/version';
  end if;
end
$check$;
commit;

select name, installed_version is not null as installed, installed_version
from pg_available_extensions
where name in ('pg_cron', 'http', 'supabase_vault')
order by name;
