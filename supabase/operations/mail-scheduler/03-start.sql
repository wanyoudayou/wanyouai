-- ACTIVATE: will call the worker every minute and send eligible queued email.
-- Review the target, queue and recipient authorization before executing.
-- First activation requires an empty queue, preventing surprise backlog sends.
begin;
set local statement_timeout = '15s';
do $start$
declare
  target_job bigint;
begin
  select jobid into strict target_job from cron.job
    where jobname = 'wanyou-mail-outbox' and username = current_user;
  if not exists (select 1 from cron.job where jobid = target_job
    and command like '%-- wanyou-mail-outbox synchronous-http/v1%') then
    raise exception 'Unexpected scheduler transport; inspect before activating';
  end if;
  if exists (select 1 from public.email_outbox where status <> 'sent') then
    raise exception 'Review unsent or terminated mail tasks before enabling automatic delivery';
  end if;
  perform cron.alter_job(target_job, active := true);
end
$start$;
commit;
select jobid, jobname, schedule, active
from cron.job where jobname = 'wanyou-mail-outbox';
