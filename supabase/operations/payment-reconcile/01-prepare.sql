-- Run after the application migration and mail-scheduler/01-enable.sql.
-- Creates ONE INACTIVE job; this file makes no HTTP request.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
do $prepare$
declare
  worker_url text;
  worker_secret text;
  new_job_id bigint;
begin
  if current_user <> 'postgres' then raise exception 'Run scheduler preparation as postgres'; end if;
  if exists (select 1 from cron.job where jobname = 'wanyou-payment-reconcile') then
    raise exception 'Job already exists; inspect it instead of overwriting it';
  end if;
  if to_regprocedure('public.claim_pending_payment_reconciliation()') is null
     or to_regprocedure('extensions.http(extensions.http_request)') is null
     or to_regprocedure('extensions.http_set_curlopt(character varying,character varying)') is null
     or to_regprocedure('extensions.http_reset_curlopt()') is null then
    raise exception 'Install application migration and HTTP extensions before preparation';
  end if;
  if has_column_privilege('anon', 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT')
     or has_column_privilege('authenticated', 'vault.decrypted_secrets', 'decrypted_secret', 'SELECT') then
    raise exception 'Application role can SELECT Vault secrets';
  end if;
  if current_setting('log_min_messages') in ('debug5','debug4','debug3','debug2')
     or current_setting('client_min_messages') in ('debug5','debug4','debug3','debug2') then
    raise exception 'Scheduler requires non-debug HTTP logging';
  end if;
  select decrypted_secret into strict worker_url from vault.decrypted_secrets
    where name = 'wanyou_payment_reconcile_url';
  select decrypted_secret into strict worker_secret from vault.decrypted_secrets
    where name = 'wanyou_mail_cron_secret';
  if worker_url is null or worker_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?/api/cron/payment-reconcile$' then
    raise exception 'Vault worker URL must be the HTTPS production payment-reconcile endpoint';
  end if;
  if worker_secret is null or length(worker_secret) < 16 or worker_secret ~ '[[:space:]]' then
    raise exception 'Vault cron secret must be the exact production CRON_SECRET';
  end if;

  new_job_id := cron.schedule('wanyou-payment-reconcile', '* * * * *', $command$
-- wanyou-payment-reconcile synchronous-http/v1
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
    raise exception 'Payment scheduler Vault permissions are unsafe';
  end if;
  if current_setting('log_min_messages') in ('debug5','debug4','debug3','debug2')
     or current_setting('client_min_messages') in ('debug5','debug4','debug3','debug2') then
    raise exception 'Payment scheduler requires non-debug HTTP logging';
  end if;
  select decrypted_secret into strict worker_url from vault.decrypted_secrets
    where name = 'wanyou_payment_reconcile_url';
  select decrypted_secret into strict worker_secret from vault.decrypted_secrets
    where name = 'wanyou_mail_cron_secret';
  if worker_url is null or worker_url !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+(:443)?/api/cron/payment-reconcile$'
     or worker_secret is null or length(worker_secret) < 16 or worker_secret ~ '[[:space:]]' then
    raise exception 'Payment scheduler Vault configuration is invalid';
  end if;
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
    raise exception 'Payment scheduler HTTPS request failed (SQLSTATE %)', SQLSTATE;
  end;
  worker_secret := null;
  if response.status is distinct from 200 then
    raise exception 'Payment scheduler HTTP status %; inspect worker configuration', response.status;
  end if;
  begin
    payload := response.content::jsonb;
  exception when others then
    raise exception 'Payment scheduler response is not valid JSON';
  end;
  if jsonb_typeof(payload->'summary') is distinct from 'object'
     or payload->'reason' is distinct from 'null'::jsonb then
    raise exception 'Payment scheduler response is not a healthy reconciliation result';
  end if;
  raise notice 'wanyou-payment-reconcile http_status=200';
end
$worker$;
  $command$);
  perform cron.alter_job(new_job_id, active := false);
end
$prepare$;
commit;
select jobid, jobname, schedule, active from cron.job
where jobname = 'wanyou-payment-reconcile';
