-- Read-only, one result set. Never return command, headers, body or raw errors.
select j.jobid, j.jobname, j.schedule, j.active,
       j.command like '%-- wanyou-mail-outbox synchronous-http/v1%' as synchronous_http,
       public.email_outbox_health() as queue_health,
       coalesce((select jsonb_agg(to_jsonb(recent) order by recent.start_time desc)
         from (select r.runid, r.status, r.start_time, r.end_time
               from cron.job_run_details r where r.jobid = j.jobid
               order by r.start_time desc limit 5) recent), '[]'::jsonb) as recent_runs
from cron.job j where j.jobname = 'wanyou-mail-outbox';
-- For this transport, succeeded means HTTP 200 and enabled worker JSON passed.
-- It does not prove a particular email was delivered or that monitoring exists.
