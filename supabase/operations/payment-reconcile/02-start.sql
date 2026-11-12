-- ACTIVATE: may query ZPAY and settle eligible paid orders, granting rights and queuing mail.
begin;
set local statement_timeout = '15s';
do $start$
declare target_job bigint;
begin
  if current_user <> 'postgres' then raise exception 'Run scheduler activation as postgres'; end if;
  select jobid into strict target_job from cron.job
    where jobname='wanyou-payment-reconcile' and username=current_user;
  if not exists (select 1 from cron.job where jobid=target_job
    and command like '%-- wanyou-payment-reconcile synchronous-http/v1%') then
    raise exception 'Unexpected scheduler transport; inspect before activating';
  end if;
  perform cron.alter_job(target_job, active := true);
end
$start$;
commit;
select jobid, jobname, schedule, active from cron.job
where jobname='wanyou-payment-reconcile';
