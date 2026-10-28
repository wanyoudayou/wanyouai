-- Read-only. Does not show cron command, Vault values, or payment references.
select j.jobid, j.jobname, j.schedule, j.active,
       j.command like '%-- wanyou-payment-reconcile synchronous-http/v1%' as synchronous_http,
       (select count(*) from public.orders o where o.status='pending'
         and o.created_at <= now()-interval '10 minutes') as aged_pending,
       (select count(*) from public.orders o where o.status='pending'
         and o.created_at <= now()-interval '10 minutes'
         and (o.reconcile_checked_at is null or o.reconcile_checked_at <= now()-interval '30 minutes')) as due_now,
       coalesce((select jsonb_agg(to_jsonb(recent) order by recent.start_time desc)
         from (select r.runid, r.status, r.start_time, r.end_time
               from cron.job_run_details r where r.jobid=j.jobid
               order by r.start_time desc limit 5) recent), '[]'::jsonb) as recent_runs
from cron.job j where j.jobname='wanyou-payment-reconcile';
