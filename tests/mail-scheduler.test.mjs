import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// Real SQL control flow with extension doubles. Native HTTP/TLS and the hosted
// cron worker must be verified separately; these tests do not prove delivery.
test("mail scheduler safely prepares and checks synchronous HTTP", { timeout: 30000 }, async (t) => {
  const db = new PGlite();
  const read = (name) => readFile(new URL(`../supabase/operations/mail-scheduler/${name}.sql`, import.meta.url), "utf8");
  const [enable, prepare, start, status, stop, permissions] = await Promise.all(
    ["01-enable", "02-prepare", "03-start", "04-status", "05-stop", "00-check-permissions"].map(read));
  const rows = async (sql) => (await db.query(sql)).rows;
  const reject = async (sql, pattern) => {
    await assert.rejects(db.exec(sql), pattern);
    await db.exec("rollback");
  };
  let job;
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema cron; create schema net; create schema vault; create schema extensions;
      create table cron.job(jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true, username text default current_user);
      create table cron.job_run_details(runid bigint,jobid bigint,status text,start_time timestamptz,end_time timestamptz);
      create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;
      create function cron.alter_job(job_id bigint,schedule text default null,command text default null,database text default null,username text default null,active boolean default null) returns void language sql as $$update cron.job j set active=coalesce($6,j.active) where j.jobid=$1$$;
      create table net.http_request_queue(headers jsonb);
      grant usage on schema net to public; grant all on net.http_request_queue to public;
      create table vault.secrets(name text primary key,decrypted_secret text);
      create view vault.decrypted_secrets as select * from vault.secrets;
      create table public.email_outbox(status text);
      create function public.email_outbox_health() returns jsonb language sql as $$select jsonb_build_object('pending',count(*) filter(where status='pending'),'sent',count(*) filter(where status='sent')) from public.email_outbox$$;
      create type extensions.http_header as (field varchar,value varchar);
      create type extensions.http_request as (method text,uri varchar,headers extensions.http_header[],content_type varchar,content varchar);
      create type extensions.http_response as (status integer,content_type varchar,headers extensions.http_header[],content varchar);
      create table public.http_test_options(name text primary key,value text);
      create table public.http_test_calls(request extensions.http_request);
      create table public.http_test_response(status int,content text,transport_error boolean default false);
      insert into public.http_test_response values(200,'{"enabled":true,"health":{"pending":0}}');
      create function extensions.http_reset_curlopt() returns boolean language plpgsql as $$begin delete from public.http_test_options; return true; end$$;
      create function extensions.http_set_curlopt(varchar,varchar) returns boolean language plpgsql as $$begin insert into public.http_test_options values($1,$2); return true; end$$;
      create function extensions.http(extensions.http_request) returns extensions.http_response language plpgsql as $$declare r public.http_test_response; begin
        select * into r from public.http_test_response;
        if r.transport_error then raise exception 'UNSAFE_REMOTE_ERROR_test-only-token'; end if;
        insert into public.http_test_calls values($1);
        return row(r.status,'application/json',null,r.content)::extensions.http_response;
      end$$;
    `);
    await t.test("enable validates available APIs without changing managed net ACLs", async () => {
      await db.exec(enable.replace(/^create extension .*;$/gm, ""));
      assert.equal((await rows("select has_schema_privilege('anon','net','USAGE') allowed"))[0].allowed, true);
    });
    await t.test("missing Vault values create no job", async () => {
      await reject(prepare, /no rows/);
      assert.equal((await rows("select count(*)::int n from cron.job"))[0].n, 0);
      await db.exec("insert into vault.secrets values('wanyou_mail_worker_url','https://site.example/api/cron/mail-outbox'),('wanyou_mail_cron_secret','test-only-token-1234567890')");
    });
    await t.test("column-level Vault SELECT blocks even without schema USAGE", async () => {
      await db.exec("grant select(decrypted_secret) on vault.decrypted_secrets to authenticated");
      await reject(prepare, /can SELECT Vault secrets/);
      await db.exec("revoke select(decrypted_secret) on vault.decrypted_secrets from authenticated");
    });
    await t.test("unsafe endpoint and newline in bearer are rejected", async () => {
      await db.exec("update vault.secrets set decrypted_secret='http://site.example/api/cron/mail-outbox' where name='wanyou_mail_worker_url'");
      await reject(prepare, /HTTPS production/);
      await db.exec("update vault.secrets set decrypted_secret='https://site.example/api/cron/mail-outbox' where name='wanyou_mail_worker_url'; update vault.secrets set decrypted_secret=E'bad\\ntoken123456789012345' where name='wanyou_mail_cron_secret'");
      await reject(prepare, /exact nonempty/);
      await db.exec("update vault.secrets set decrypted_secret='test-only-token-1234567890' where name='wanyou_mail_cron_secret'");
    });
    await t.test("verbose header logging blocks preparation", async () => {
      await db.exec("set client_min_messages='debug2'");
      await reject(prepare, /non-debug HTTP logging/);
      await db.exec("set client_min_messages='notice'");
    });
    await t.test("net PUBLIC grants do not force secrets into a shared table", async () => {
      await db.exec(prepare);
      [job] = await rows("select * from cron.job");
      assert.equal(job.active, false);
      assert.equal(job.command.includes("test-only-token"), false);
      assert.equal((await rows("select count(*)::int n from public.http_test_calls"))[0].n, 0);
      assert.equal((await rows("select count(*)::int n from net.http_request_queue"))[0].n, 0);
      const flags = await rows(permissions);
      assert.ok(flags.every(r => r.net_usage && r.net_headers_select && !r.vault_secret_select));
    });
    await t.test("existing job cannot be silently overwritten", () => reject(prepare, /already exists/));
    await t.test("old transport and pending backlog cannot activate", async () => {
      await db.exec("update cron.job set command='select 1'");
      await reject(start, /Unexpected scheduler transport/);
      await db.query("update cron.job set command=$1", [job.command]);
      await db.exec("insert into public.email_outbox values('pending')");
      await reject(start, /Review unsent/);
      await db.exec("update public.email_outbox set status='sent'");
      await db.exec(start);
      assert.equal((await rows("select active from cron.job"))[0].active, true);
    });
    await t.test("request has bounded timeouts, verified TLS and exact header", async () => {
      await db.exec(job.command);
      const [{ uri, token, content }] = await rows("select (request).uri, ((request).headers[1]).value token, (request).content from public.http_test_calls");
      assert.equal(uri, "https://site.example/api/cron/mail-outbox");
      assert.equal(token, "Bearer test-only-token-1234567890");
      assert.equal(content, "{}");
      const options = Object.fromEntries((await rows("select * from public.http_test_options")).map(r => [r.name, r.value]));
      assert.deepEqual(options, { CURLOPT_CONNECTTIMEOUT_MS: "5000", CURLOPT_TIMEOUT_MS: "55000", CURLOPT_SSL_VERIFYPEER: "1", CURLOPT_SSL_VERIFYHOST: "2" });
    });
    await t.test("non-200, malformed JSON and login HTML cannot report success", async () => {
      for (const [code, body, expected] of [[401, '{}', /HTTP status 401/], [503, '{}', /HTTP status 503/], [302, '{}', /HTTP status 302/], [200, '<html>login</html>', /not valid JSON/], [200, '{"enabled":false}', /not an enabled/]]) {
        await db.query("update public.http_test_response set status=$1,content=$2", [code, body]);
        await reject(job.command, expected);
      }
    });
    await t.test("transport error suppresses upstream message and token", async () => {
      await db.exec("update public.http_test_response set transport_error=true");
      await assert.rejects(db.exec(job.command), err => {
        assert.match(err.message, /HTTPS request failed/);
        assert.doesNotMatch(JSON.stringify(err), /UNSAFE_REMOTE_ERROR|test-only-token/);
        return true;
      });
      await db.exec("rollback; update public.http_test_response set transport_error=false,status=200,content='{\"enabled\":true,\"health\":{}}'");
    });
    await t.test("runtime checks reject unsafe Vault grants and debug logging", async () => {
      await db.exec("grant select on vault.decrypted_secrets to anon");
      await reject(job.command, /Vault permissions are unsafe/);
      await db.exec("revoke select on vault.decrypted_secrets from anon; set log_min_messages='debug2'");
      await reject(job.command, /non-debug HTTP logging/);
      await db.exec("set log_min_messages='warning'");
    });
    await t.test("status exposes no credential, raw response or command", async () => {
      const result = await rows(status);
      assert.equal(result[0].synchronous_http, true);
      assert.doesNotMatch(JSON.stringify(result), /test-only-token|Authorization|UNSAFE_REMOTE_ERROR/);
    });
    await t.test("stop preserves unrelated jobs and sent audit", async () => {
      await db.exec("insert into cron.job(jobname,schedule,command) values('unrelated','0 0 * * *','select 1')");
      await db.exec(stop);
      assert.deepEqual(await rows("select jobname,active from cron.job order by jobid"), [{ jobname: "wanyou-mail-outbox", active: false }, { jobname: "unrelated", active: true }]);
      assert.equal((await rows("select count(*)::int n from public.email_outbox where status='sent'"))[0].n, 1);
    });
  } finally { await db.close(); }
});
