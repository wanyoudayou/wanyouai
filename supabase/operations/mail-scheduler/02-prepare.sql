-- First run 01-enable.sql and configure the two Vault names in docs/mail-scheduler.md.
-- Creates ONE INACTIVE job. Does not send HTTP or email.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
do $prepare$
declare
  worker_url text;
  worker_secret text;
  new_job_id bigint;
begin
  if current_user <> 'postgres' then
    raise exception 'Run scheduler preparation as postgres';
  end if;
  if exists (select 1 from cron.job where jobname = 'wanyou-mail-outbox') then
    raise exception 'Job already exists; inspect it instead of overwriting it';
  end if;
  if to_regprocedure('public.email_outbox_health()') is null
     or to_regprocedure('extensions.http(extensions.http_request)') is null
     or to_regprocedure('extensions.http_set_curlopt(character varying,character varying)') is null
     or to_regprocedure('extensions.http_reset_curlopt()') is null then
    raise exception 'Install application and run 01-enable.sql before preparation';
  end if;
  if has_column_privilege('anon', 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT')
     or has_column_privilege('authenticated', 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT') then
    raise exception 'Scheduler blocked: application role can SELECT Vault secrets'
      using hint = 'Run 00-check-permissions.sql; review Vault grants';
  end if;
  -- pgsql-http can log headers at DEBUG2; fail before reading credentials.
  if current_setting('log_min_messages') in ('debug5','debug4','debug3','debug2')
     or current_setting('client_min_messages') in ('debug5','debug4','debug3','debug2') then
    raise exception 'Mail scheduler requires non-debug HTTP logging';
  end if;
  select decrypted_secret into strict worker_url
    from vault.decrypted_secrets where name = 'wanyou_mail_worker_url';
  select decrypted_secret into strict worker_secret
    from vault.decrypted_secrets where name = 'wanyou_mail_cron_secret';
  if worker_url is null or worker_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?/api/cron/mail-outbox$' then
    raise exception 'Vault worker URL must be the HTTPS production mail-outbox endpoint';
  end if;
  if worker_secret is null or length(worker_secret) < 16 or worker_secret ~ '[[:space:]]' then
    raise exception 'Vault cron secret must be the exact nonempty production CRON_SECRET';
  end if;

  new_job_id := cron.schedule('wanyou-mail-outbox', '* * * * *', $command$
-- wanyou-mail-outbox synchronous-http/v1
set statement_timeout = '60s';
do $worker$
declare
  worker_url text;
  worker_secret text;
  response extensions.http_response;
  payload jsonb;
begin
  if has_column_privilege('anon', 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT')
     or has_column_privilege('authenticated', 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT') then
    raise exception 'Mail scheduler Vault permissions are unsafe';
  end if;
  -- pgsql-http can log headers at DEBUG2; fail before reading credentials.
  if current_setting('log_min_messages') in ('debug5','debug4','debug3','debug2')
     or current_setting('client_min_messages') in ('debug5','debug4','debug3','debug2') then
    raise exception 'Mail scheduler requires non-debug HTTP logging';
  end if;
  select decrypted_secret into strict worker_url
    from vault.decrypted_secrets where name = 'wanyou_mail_worker_url';
  select decrypted_secret into strict worker_secret
    from vault.decrypted_secrets where name = 'wanyou_mail_cron_secret';
  if worker_url is null or worker_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?/api/cron/mail-outbox$'
     or worker_secret is null or length(worker_secret) < 16 or worker_secret ~ '[[:space:]]' then
    raise exception 'Mail scheduler Vault configuration is invalid';
  end if;

  -- Dedicated cron connection: clear inherited proxy/TLS options, then bound I/O.
  -- Never put credentials in curl options, SQL literals, logs or a queue table.
  begin
    if not extensions.http_reset_curlopt()
       or not extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '5000')
       or not extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '55000')
       or not extensions.http_set_curlopt('CURLOPT_SSL_VERIFYPEER', '1')
       or not extensions.http_set_curlopt('CURLOPT_SSL_VERIFYHOST', '2') then
      raise exception 'HTTP options rejected';
    end if;
    select * into strict response from extensions.http((
      'POST', worker_url,
      array[row('Authorization', 'Bearer ' || worker_secret)::extensions.http_header],
      'application/json', '{}'
    )::extensions.http_request);
  exception when others then
    -- Extension errors may contain remote data: do not forward SQLERRM/response.
    raise exception 'Mail scheduler HTTPS request failed (SQLSTATE %)', SQLSTATE;
  end;
  worker_secret := null;
  if response.status is distinct from 200 then
    raise exception 'Mail scheduler HTTP status %; inspect worker configuration', response.status;
  end if;
  begin
    payload := response.content::jsonb;
  exception when others then
    raise exception 'Mail scheduler response is not valid JSON';
  end;
  if payload->'enabled' is distinct from 'true'::jsonb
     or jsonb_typeof(payload->'health') is distinct from 'object' then
    raise exception 'Mail scheduler response is not an enabled worker result';
  end if;
  -- Only successful HTTP 200 + worker JSON can complete this cron command.
  raise notice 'wanyou-mail-outbox http_status=200';
end
$worker$;
  $command$);
  perform cron.alter_job(new_job_id, active := false);
end
$prepare$;
commit;

select jobid, jobname, schedule, active,
       public.email_outbox_health() as queue_health
from cron.job where jobname = 'wanyou-mail-outbox';
