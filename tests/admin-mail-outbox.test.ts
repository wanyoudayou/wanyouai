import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";

test("mail outbox: atomic settlement, compatibility, frozen messages, leases and private RPCs", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  const target = (await db.query<{ id: number }>("select id from articles where slug='demo-paid-single-blog'")).rows[0].id;
  const rpc = async <T>(sql: string, args: unknown[] = []) => (await db.query<{ result: T }>(`select ${sql} result`, args)).rows[0].result;
  const newOrder = async () => {
    await db.exec("reset role");
    const user = randomUUID();
    await db.query("insert into auth.users(id,email) values($1,'fixture@example.test')", [user]);
    await db.exec("set role service_role");
    return (await db.query<{ id: number }>("insert into orders(user_id,sku_type,target_id,amount) values($1,'single',$2,19) returning id", [user, target])).rows[0].id;
  };
  const settle = (id: number, queued = true) => rpc<string>(`${queued ? "settle_payment_queued" : "settle_payment"}($1,$2,19,(select jsonb_build_object('out_trade_no',merchant_order_no) from orders where id=$1))`, [id, `T${id}`]);
  const claim = () => rpc<{ id: string; lease_token: string; message: unknown; started_at: string; provider_fingerprint: string } | null>("claim_email_job()");
  const msg = { from: "Site <sender@example.test>", to: "fixture@example.test", subject: "test", html: "<p>safe</p>", text: "safe" };
  const fingerprint = "a".repeat(64);
  const count = () => rpc<number>("(select count(*)::int from email_outbox)");

  const legacy = await newOrder();
  assert.equal(await settle(legacy, false), "settled");
  assert.equal(await count(), 0);
  assert.equal(await settle(legacy), "duplicate");
  assert.equal(await count(), 0, "Historical rights are not backfilled by callback replay");
  const id = await newOrder();
  assert.equal(await settle(id), "settled");
  assert.equal(await count(), 1);
  assert.equal(await settle(id), "duplicate");
  assert.equal(await count(), 1);
  assert.notEqual(await rpc<string>("current_setting('youai.queue_mail',true)"), "on");
  const job = (await claim())!;
  assert.ok(job.id && job.lease_token);
  assert.equal(await claim(), null, "Active lease cannot be claimed again");
  await assert.rejects(rpc("prepare_email_job($1,$2,$3,$4)", [job.id, randomUUID(), JSON.stringify(msg), fingerprint]), /MAIL_LEASE_LOST/);
  const prepared = await rpc<typeof job>("prepare_email_job($1,$2,$3,$4)", [job.id, job.lease_token, JSON.stringify(msg), fingerprint]);
  assert.deepEqual(prepared.message, msg);
  const unchanged = await rpc<typeof job>("prepare_email_job($1,$2,$3,$4)", [job.id, job.lease_token, JSON.stringify({ ...msg, to: "changed@example.test" }), "b".repeat(64)]);
  assert.deepEqual(unchanged.message, msg);
  assert.equal(unchanged.provider_fingerprint, fingerprint);
  assert.equal(unchanged.started_at, prepared.started_at);
  await assert.rejects(rpc("finish_email_job($1,$2,'sent',null,null)", [job.id, job.lease_token]), /MAIL_RECEIPT_REQUIRED/);
  assert.equal(await rpc("finish_email_job($1,$2,'retry','network',null)", [job.id, job.lease_token]), true);
  assert.equal(await claim(), null, "Backoff is enforced by DB, not caller clock");
  await db.query("update email_outbox set next_attempt_at=now()-interval '1 second' where id=$1", [job.id]);
  const retry = (await claim())!;
  assert.notEqual(retry.lease_token, job.lease_token);
  assert.equal(await rpc("finish_email_job($1,$2,'sent',null,'old-receipt')", [job.id, job.lease_token]), false);
  await db.query("update email_outbox set lease_until=now()-interval '1 second' where id=$1", [job.id]);
  const recovered = (await claim())!;
  assert.notEqual(recovered.lease_token, retry.lease_token);
  assert.deepEqual(recovered.message, msg);
  assert.equal(await rpc("finish_email_job($1,$2,'sent',null,'old-receipt')", [job.id, retry.lease_token]), false);
  assert.equal(await rpc("finish_email_job($1,$2,'sent',null,'accepted-id')", [job.id, recovered.lease_token]), true);
  assert.equal(await claim(), null);

  const failing = await newOrder();
  await db.exec(`reset role; alter table email_outbox add constraint test_mail_failure check(order_id<>${failing}); set role service_role`);
  await assert.rejects(settle(failing), /test_mail_failure/);
  assert.equal(await rpc("(select status from orders where id=$1)", [failing]), "pending");
  assert.equal(await rpc("(select count(*)::int from payment_events where event_id=$1)", [`T${failing}`]), 0);
  assert.equal(await rpc("(select count(*)::int from entitlements where source_ref=$1)", [`order:${failing}`]), 0);
  await db.exec("reset role; alter table email_outbox drop constraint test_mail_failure; set role service_role");
  assert.equal(await settle(failing), "settled");
  const expiring = (await claim())!;
  await rpc("prepare_email_job($1,$2,$3,$4)", [expiring.id, expiring.lease_token, JSON.stringify(msg), fingerprint]);
  await db.query("update email_outbox set started_at=now()-interval '23 hours',lease_until=now()-interval '1 second' where id=$1", [expiring.id]);
  assert.equal(await claim(), null);
  assert.equal(await rpc("(select last_error from email_outbox where id=$1)", [expiring.id]), "window_expired");
  const exhaustedId = await newOrder(); await settle(exhaustedId);
  await db.query("update email_outbox set attempts=8 where order_id=$1", [exhaustedId]);
  assert.equal(await claim(), null);
  assert.equal(await rpc("(select last_error from email_outbox where order_id=$1)", [exhaustedId]), "attempts_exhausted");
  const health = await rpc<Record<string, number>>("email_outbox_health()");
  assert.equal(health.dead, 2); assert.equal(health.sent, 1);
  assert.deepEqual(Object.keys(health).sort(), ["dead", "oldest_due_seconds", "pending", "processing", "sent"]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`reset role; set role ${role}`);
    await assert.rejects(db.query("select * from email_outbox"), /permission denied/);
    for (const sql of ["claim_email_job()", "email_outbox_health()", "settle_payment_queued(1,'x',1,'{}')",
      "prepare_email_job(gen_random_uuid(),gen_random_uuid(),'{}','')", "finish_email_job(gen_random_uuid(),gen_random_uuid(),'sent',null,'x')"])
      await assert.rejects(rpc(sql), /permission denied/);
  }
});
