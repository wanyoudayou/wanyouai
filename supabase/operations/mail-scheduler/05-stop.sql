-- Stop future ticks of ONLY this job; preserve extensions, secrets and history.
-- An HTTP request already running can still finish. Do not reset leases.
select cron.alter_job(jobid, active := false)
from cron.job
where jobname = 'wanyou-mail-outbox' and username = current_user;
select jobid, jobname, active
from cron.job where jobname = 'wanyou-mail-outbox';
