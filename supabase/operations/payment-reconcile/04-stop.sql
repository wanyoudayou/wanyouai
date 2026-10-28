-- Stops only future ticks of this task; an HTTP request already running may finish.
select cron.alter_job(jobid, active := false) from cron.job
where jobname='wanyou-payment-reconcile' and username=current_user;
select jobid, jobname, active from cron.job
where jobname='wanyou-payment-reconcile';
