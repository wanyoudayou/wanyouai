import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// SQL control flow with local doubles. Native HTTP, TLS, Cron and ZPAY need hosted verification.
test("payment scheduler keeps its bearer in Vault and fails closed", { timeout: 30000 }, async () => {
  const db = new PGlite();
  const read = name => readFile(new URL(`../supabase/operations/payment-reconcile/${name}.sql`, import.meta.url), "utf8");
  const [prepare, start, status, stop] = await Promise.all(["01-prepare", "02-start", "03-status", "04-stop"].map(read));
  const rows = async sql => (await db.query(sql)).rows;
  const reject = async (sql, pattern) => { await assert.rejects(db.exec(sql), pattern); await db.exec("rollback"); };
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema cron; create schema vault; create schema extensions;
      create table cron.job(jobid bigserial primary key,jobname text unique,schedule text,command text,active boolean default true,username text default current_user);
      create table cron.job_run_details(runid bigint,jobid bigint,status text,start_time timestamptz,end_time timestamptz);
      create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;
      create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language sql as $$update cron.job j set active=coalesce($6,j.active) where j.jobid=$1$$;
      create table vault.secrets(name text primary key,decrypted_secret text);
      create view vault.decrypted_secrets as select * from vault.secrets;
      create table public.orders(id bigint,status text,created_at timestamptz,reconcile_checked_at timestamptz);
      create function public.claim_pending_payment_reconciliation() returns integer language sql as $$select 1$$;
      create type extensions.http_header as (field varchar,value varchar);
      create type extensions.http_request as (method text,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
      create type extensions.http_response as (status integer,content_type varchar,headers extensions.http_header[],content varchar);
      create table public.http_test_calls(request extensions.http_request);
      create table public.http_test_response(status int,content text);
      insert into public.http_test_response values(200,'{"summary":{"scanned":0},"reason":null}');
      create function extensions.http_reset_curlopt() returns boolean language sql as $$select true$$;
      create function extensions.http_set_curlopt(varchar,varchar) returns boolean language sql as $$select true$$;
      create function extensions.http(extensions.http_request) returns extensions.http_response language plpgsql as $$declare r public.http_test_response; begin
        insert into public.http_test_calls values($1);
        select * into r from public.http_test_response;
        return row(r.status,'application/json',null,r.content)::extensions.http_response;
      end$$;
    `);
    await reject(prepare, /no rows/);
    await db.exec("insert into vault.secrets values('wanyou_payment_reconcile_url','https://site.example/api/cron/payment-reconcile'),('wanyou_mail_cron_secret','test-only-token-1234567890')");
    await db.exec("grant select(decrypted_secret) on vault.decrypted_secrets to anon");
    await reject(prepare, /can SELECT Vault/);
    await db.exec("revoke select(decrypted_secret) on vault.decrypted_secrets from anon");
    await db.exec(prepare);
    const [job] = await rows("select * from cron.job");
    assert.equal(job.active, false);
    assert.equal(job.command.includes("test-only-token"), false);
    assert.equal((await rows("select count(*)::int n from public.http_test_calls"))[0].n, 0);
    await reject(prepare, /already exists/);
    await db.exec(start);
    assert.equal((await rows("select active from cron.job"))[0].active, true);
    await db.exec(job.command);
    const [{ uri, token }] = await rows("select (request).uri, ((request).headers[1]).value token from public.http_test_calls");
    assert.equal(uri, "https://site.example/api/cron/payment-reconcile");
    assert.equal(token, "Bearer test-only-token-1234567890");
    assert.equal((await rows(status))[0].synchronous_http, true);
    await db.exec("update public.http_test_response set status=503");
    await reject(job.command, /HTTP status 503/);
    await db.query("update public.http_test_response set status=200,content=$1", ['{"summary":{},"reason":"claim_failed"}']);
    await reject(job.command, /not a healthy reconciliation result/);
    await db.exec(stop);
    assert.equal((await rows("select active from cron.job"))[0].active, false);
  } finally { await db.close(); }
});
