import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { after, afterEach, before, test } from "node:test";
import pg from "pg";
import { collectExportRows } from "../src/lib/admin/export-pagination.ts";
import { parseExportSnapshot } from "../src/lib/admin/export-snapshot.ts";
import { reconcileAutomatic } from "../src/lib/payments/reconcile.ts";
import { settleIfPaidRemotely } from "../src/lib/payments/settle.ts";
import { preparePublication } from "../src/lib/publishing/pipeline.ts";
import { knowledgeParts } from "../src/lib/ai/knowledge.ts";

// Only a disposable local PostgreSQL server is accepted. Never load .env.local.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString)
  throw new Error(
    "TEST_DATABASE_URL is required; see docs/development/database-concurrency.md",
  );
const url = new URL(connectionString);
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.search ||
  url.hash
) {
  throw new Error(
    "Concurrency tests require a local disposable PostgreSQL server",
  );
}
const database = `wanyou_concurrency_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(url);
testUrl.pathname = `/${database}`;
const admin = new pg.Client({
  connectionString,
  connectionTimeoutMillis: 5000,
});
const sessions = new Set();
let observer;
let blocker;
let created = false;
const directory = new URL("../supabase/", import.meta.url);

async function connect(role = null) {
  const client = new pg.Client({
    connectionString: testUrl.href,
    connectionTimeoutMillis: 5000,
    application_name: "wanyou-concurrency",
  });
  await client.connect();
  sessions.add(client);
  await client.query(
    "set statement_timeout='10s'; set lock_timeout='8s'; set default_transaction_isolation='read committed'",
  );
  if (role) await client.query(`set role ${role}`); // role is fixed by this test, never user input
  const { rows } = await client.query("select pg_backend_pid() pid");
  client.backendPid = rows[0].pid;
  return client;
}

before(
  async () => {
    await admin.connect();
    const { rows } = await admin.query(
      "select current_setting('server_version_num')::int version, rolsuper from pg_roles where rolname=current_user",
    );
    assert(
      rows[0].rolsuper,
      "Use the administrator of a disposable PostgreSQL instance",
    );
    assert(
      rows[0].version >= 170000,
      "PostgreSQL 17+ is required by the release SQL",
    );
    // Roles are cluster objects: preserve existing roles and reject unsafe role attributes.
    for (const [name, bypass] of [
      ["anon", false],
      ["authenticated", false],
      ["service_role", true],
    ]) {
      const existing = await admin.query(
        "select rolsuper,rolbypassrls from pg_roles where rolname=$1",
        [name],
      );
      if (existing.rows.length) {
        assert.equal(
          existing.rows[0].rolsuper,
          false,
          `${name} must not be a superuser`,
        );
        assert.equal(
          existing.rows[0].rolbypassrls,
          bypass,
          `${name} RLS attributes differ`,
        );
      } else
        await admin.query(`create role ${name}${bypass ? " bypassrls" : ""}`);
    }
    await admin.query(`create database ${database}`);
    created = true;
    observer = await connect();
    blocker = await connect();
    await observer.query(`
    create schema auth;
    create table auth.users (
      id uuid primary key,email text,email_confirmed_at timestamptz,
      aud text,role text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to public;
  `);
    // Run the complete generated release install, including actual pgvector/RLS/grants.
    await observer.query(
      await readFile(new URL("install.sql", directory), "utf8"),
    );
    const checks = await observer.query(
      await readFile(new URL("verify.sql", directory), "utf8"),
    );
    assert(
      checks.rows.length > 0 && checks.rows.every((row) => row.passed),
      "Fresh PostgreSQL install checks failed",
    );
    const version = await observer.query(
      "select version(), extversion from pg_extension where extname='vector'",
    );
    console.log(
      `Real database: ${version.rows[0].version}; pgvector ${version.rows[0].extversion}; verify ${checks.rows.length}/${checks.rows.length}`,
    );
  },
  { timeout: 30000 },
);

after(async () => {
  // Close all clients before DROP; never terminate unrelated PostgreSQL sessions.
  await Promise.allSettled([...sessions].map((client) => client.end()));
  try {
    if (created) await admin.query(`drop database ${database}`);
  } finally {
    await admin.end();
  }
});

afterEach(async () => {
  if (blocker) await blocker.query("rollback; select pg_advisory_unlock_all()");
  await Promise.all(
    [...sessions]
      .filter((client) => client !== blocker && client !== observer)
      .map(async (client) => {
        await client.end();
        sessions.delete(client);
      }),
  );
});

const skillManifest = JSON.stringify([{ path: "SKILL.md", size: 10, sha256: "a".repeat(64), text: true }]);

async function fixture(sku = "single") {
  const seriesType = sku === "collection" ? "collection" : "handbook";
  if (sku === "collection") sku = "series";
  const user = randomUUID();
  await observer.query("insert into auth.users(id,email) values($1,$2)", [
    user,
    `${user}@example.test`,
  ]);
  let target = null;
  if (sku === "single") {
    target = (
      await observer.query(
        "insert into articles(slug,type,title,access,price,status,published_at) values($1,'blog','Concurrent fixture','paid',10,'published',now()) returning id",
        [user],
      )
    ).rows[0].id;
  } else if (sku === "skill") {
    target = (await observer.query("insert into articles(slug,type,title,access,status,published_at) values($1,'skill','Concurrent Skill','public','published',now()) returning id", [user])).rows[0].id;
    const release = randomUUID();
    await observer.query("insert into skill_releases(id,skill_id,version,package_sha256,byte_size,manifest,skill_name,description,online_eligible) values($1,$2,'1.0.0',$3,10,$4,'synthetic-skill','Synthetic',true)", [release, target, "a".repeat(64), skillManifest]);
    await observer.query("update skills set current_release=$2,price=10,online_enabled=true where id=$1", [target, release]);
  } else if (sku === "subscription") {
    await observer.query(
      `update site_config set commerce='{"subscription_price":{"amount":10}}'::jsonb where id=1`,
    );
  } else {
    target = (
      await observer.query(
        "insert into series(slug,type,title,price,status) values($1,$2,'Concurrent fixture',10,'published') returning id",
        [user, sku === "event" ? "event" : seriesType],
      )
    ).rows[0].id;
    if (sku === "event")
      await observer.query(
        "insert into event_details(series_id,state,ticket_price,starts_at) values($1,'registering',10,now()+interval '1 day')",
        [target],
      );
  }
  return {
    user,
    sku,
    target,
    key: `order-entitlement:${user}:${sku}:${target ?? ""}`,
  };
}

const merchantReferences = new Map();
async function order(f) {
  const row = (
    await observer.query(
      "insert into orders(user_id,sku_type,target_id,amount) values($1,$2,$3,10) returning id,merchant_order_no",
      [f.user, f.sku, f.target],
    )
  ).rows[0];
  merchantReferences.set(row.id, row.merchant_order_no);
  return row.id;
}

const settle = (id, trade, source = "notify", amount = 10, legacy = false) => ({
  text: "select settle_payment_queued($1,$2,$3,$4::jsonb) result",
  values: [
    id,
    legacy ? `${source}:${id}:${trade}` : trade,
    amount,
    JSON.stringify({
      source,
      trade_no: trade,
      out_trade_no: merchantReferences.get(id),
    }),
  ],
});
const settleReference = (reference, trade, source = "notify", amount = 10) => ({
  text: "select settle_payment_reference($1,$2,$3,$4::jsonb) result",
  values: [
    reference,
    trade,
    amount,
    JSON.stringify({ source, trade_no: trade, out_trade_no: reference }),
  ],
});
const pending = (f) => ({
  text: "select create_pending_order($1,$2,$3,10) result",
  values: [f.user, f.sku, f.target],
});
const outcome = (promise) =>
  promise.then(
    (value) => ({ value: value.rows[0]?.result }),
    (error) => ({ error }),
  );

async function waitForLocks(clients) {
  const pids = clients.map((client) => client.backendPid);
  assert.equal(
    new Set(pids).size,
    pids.length,
    "Competitors must use independent backends",
  );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      "select pid from pg_stat_activity where pid=any($1::int[]) and state='active' and wait_event_type='Lock'",
      [pids],
    );
    if (rows.length === pids.length) return;
    await delay(15);
  }
  assert.fail(
    "All competitors must demonstrably overlap while waiting for database locks",
  );
}

async function compete(key, calls) {
  const clients = await Promise.all(calls.map(() => connect("service_role")));
  await blocker.query("select pg_advisory_lock(hashtextextended($1,0))", [key]);
  const results = calls.map((call, i) => outcome(clients[i].query(call)));
  try {
    await waitForLocks(clients);
  } finally {
    await blocker.query("select pg_advisory_unlock(hashtextextended($1,0))", [
      key,
    ]);
  }
  try {
    return await Promise.all(results);
  } finally {
    await Promise.all(
      clients.map(async (client) => {
        await client.end();
        sessions.delete(client);
      }),
    );
  }
}

async function snapshot(f, trades = []) {
  return (
    await observer.query(
      `select
    (select count(*)::int from orders where user_id=$1) orders,
    (select count(*)::int from orders where user_id=$1 and status='paid') paid,
    (select count(*)::int from entitlements where user_id=$1 and revoked_at is null) rights,
    (select count(*)::int from payment_events where event_id=any($2::text[])) events`,
      [f.user, trades],
    )
  ).rows[0];
}
const queueCount = async (f) =>
  (
    await observer.query(
      "select count(*)::int count from email_outbox where snapshot->>'user_id'=$1",
      [f.user],
    )
  ).rows[0].count;

for (const sku of ["single", "series", "collection", "subscription", "event", "skill"]) {
  test(
    `parallel pending requests reuse one ${sku} order`,
    { timeout: 15000 },
    async () => {
      const f = await fixture(sku);
      const results = await compete(
        f.key,
        Array.from({ length: 8 }, () => pending(f)),
      );
      assert(results.every((result) => !result.error));
      assert.equal(new Set(results.map((result) => result.value.id)).size, 1);
      assert.deepEqual(await snapshot(f), {
        orders: 1,
        paid: 0,
        rights: 0,
        events: 0,
      });
    },
  );
}

test("reference-bound notify/query/aliased return race opens rights once", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  const results = await compete(`zpay-event:${trade}`, [
    settle(id, trade),
    settle(id, trade, "reconcile"),
    settle(id, trade, "return", 10, true),
  ]);
  assert.deepEqual(results.map((r) => r.value).sort(), [
    "duplicate",
    "duplicate",
    "settled",
  ]);
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
  assert.equal(await queueCount(f), 1);
});

test("merchant reference notification, return and reconciliation race opens rights once", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  const reference = (
    await observer.query("select merchant_order_no from orders where id=$1", [
      id,
    ])
  ).rows[0].merchant_order_no;
  assert.match(reference, /^9[0-9]{31}$/);
  const results = await compete(`zpay-event:${trade}`, [
    settleReference(reference, trade),
    settleReference(reference, trade, "return"),
    settleReference(reference, trade, "reconcile"),
  ]);
  assert.deepEqual(results.map((r) => r.value).sort(), [
    "duplicate",
    "duplicate",
    "settled",
  ]);
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
  assert.equal(await queueCount(f), 1);
});

test("parallel reconciliation claims skip a locked order and retry only after cooldown", async () => {
  const f = await fixture();
  const id = await order(f);
  await observer.query(
    "update orders set created_at=now()-interval '11 minutes' where id=$1",
    [id],
  );
  const a = await connect("service_role");
  const b = await connect("service_role");
  await a.query("begin");
  try {
    assert.equal(
      (await a.query("select id from claim_pending_payment_reconciliation()"))
        .rows[0].id,
      id,
    );
    assert.deepEqual(
      (await b.query("select id from claim_pending_payment_reconciliation()"))
        .rows,
      [],
    );
  } finally {
    await a.query("commit");
  }
  assert.deepEqual(
    (await b.query("select id from claim_pending_payment_reconciliation()"))
      .rows,
    [],
  );
  await observer.query(
    "update orders set reconcile_checked_at=now()-interval '31 minutes' where id=$1",
    [id],
  );
  assert.equal(
    (await b.query("select id from claim_pending_payment_reconciliation()"))
      .rows[0].id,
    id,
  );
  const trade = randomUUID();
  assert.equal(
    (
      await b.query(
        settleReference(merchantReferences.get(id), trade, "reconcile"),
      )
    ).rows[0].result,
    "settled",
  );
  assert.deepEqual(
    (await b.query("select id from claim_pending_payment_reconciliation()"))
      .rows,
    [],
  );
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
  assert.equal(await queueCount(f), 1);
});

test("automatic query settles a paid pending order without notify or browser return", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  await observer.query(
    "update orders set created_at=now()-interval '11 minutes' where id=$1",
    [id],
  );
  const client = await connect("service_role");
  const service = {
    rpc: async (name, args = {}) => {
      try {
        if (name === "claim_pending_payment_reconciliation") {
          const { rows } = await client.query(
            "select * from claim_pending_payment_reconciliation()",
          );
          return { data: rows, error: null };
        }
        if (name === "settle_payment_reference") {
          const { rows } = await client.query(
            settleReference(
              args.p_merchant_order_no,
              args.p_event_id,
              args.p_payload.source,
              args.p_amount,
            ),
          );
          return { data: rows[0].result, error: null };
        }
        throw new Error(`Unexpected RPC: ${name}`);
      } catch (error) {
        return { data: null, error };
      }
    },
  };
  const provider = {
    queryOrder: async (row) => {
      assert.equal(row.id, id);
      assert.equal(row.merchant_order_no, merchantReferences.get(id));
      return { paid: true, tradeNo: trade, amount: 10 };
    },
  };
  const run = () =>
    reconcileAutomatic({
      deadline: 45_000,
      now: () => 0,
      claim: async () => {
        const { data, error } = await service.rpc(
          "claim_pending_payment_reconciliation",
        );
        if (error) throw error;
        return data[0] ?? null;
      },
      settle: (row) =>
        settleIfPaidRemotely(service, provider, row, "reconcile"),
    });
  const first = await run();
  assert.equal(first.reason, null);
  assert.deepEqual(first.summary, {
    scanned: 1,
    settled: 1,
    already: 0,
    unpaid: 0,
    failed: 0,
  });
  const second = await run();
  assert.equal(second.reason, null);
  assert.equal(second.summary.scanned, 0);
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
  assert.equal(await queueCount(f), 1);
});

test("old numeric callback racing a reference callback cannot settle or enqueue mail", async () => {
  const f = await fixture(),
    id = await order(f),
    trade = randomUUID();
  const oldCall = {
    text: "select settle_payment_queued($1,$2,10,$3::jsonb) result",
    values: [
      id,
      trade,
      JSON.stringify({ trade_no: trade, out_trade_no: String(id) }),
    ],
  };
  const results = await compete(`zpay-event:${trade}`, [
    oldCall,
    settleReference(merchantReferences.get(id), trade),
  ]);
  assert.match(results[0].error?.message ?? "", /PAYMENT_REFERENCE_MISMATCH/);
  assert.equal(results[1].value, "settled");
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
  assert.equal(await queueCount(f), 1);
});

test("same provider trade cannot settle different orders", async () => {
  const a = await fixture();
  const b = await fixture();
  const x = await order(a);
  const y = await order(b);
  const trade = randomUUID();
  const results = await compete(`zpay-event:${trade}`, [
    settle(x, trade),
    settle(y, trade),
  ]);
  assert.equal(results.filter((r) => r.value === "settled").length, 1);
  assert.equal(
    results.filter((r) => r.error?.message.includes("EVENT_ORDER_MISMATCH"))
      .length,
    1,
  );
  const event = (
    await observer.query(
      "select payload->>'settlement_order_id' bound from payment_events where event_id=$1",
      [trade],
    )
  ).rows[0];
  for (const [f, id] of [
    [a, x],
    [b, y],
  ]) {
    const winner = event.bound === id;
    assert.deepEqual(await snapshot(f, [trade]), {
      orders: 1,
      paid: Number(winner),
      rights: Number(winner),
      events: 1,
    });
  }
});

test("different paid orders for one SKU create one entitlement", async () => {
  const f = await fixture();
  const x = await order(f);
  const y = await order(f);
  const trades = [randomUUID(), randomUUID()];
  const results = await compete(f.key, [
    settle(x, trades[0]),
    settle(y, trades[1]),
  ]);
  assert(results.every((r) => r.value === "settled"));
  // Existing duplicate orders may both be paid: entitlement deduplication is not a refund.
  assert.deepEqual(await snapshot(f, trades), {
    orders: 2,
    paid: 2,
    rights: 1,
    events: 2,
  });
  assert.equal(await queueCount(f), 1);
});

test("different provider trades on one order do not reopen rights", async () => {
  const f = await fixture();
  const id = await order(f);
  const trades = [randomUUID(), randomUUID()];
  const clients = await Promise.all([
    connect("service_role"),
    connect("service_role"),
  ]);
  await blocker.query("begin");
  await blocker.query("select id from orders where id=$1 for update", [id]);
  const results = clients.map((client, i) =>
    outcome(client.query(settle(id, trades[i]))),
  );
  try {
    await waitForLocks(clients);
    await blocker.query("commit");
  } finally {
    await blocker.query("rollback");
  }
  assert.deepEqual((await Promise.all(results)).map((r) => r.value).sort(), [
    "already_paid",
    "settled",
  ]);
  assert.deepEqual(await snapshot(f, trades), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 2,
  });
  assert.equal(await queueCount(f), 1);
});

test("new order and payment race does not create another pending order", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  const results = await compete(f.key, [settle(id, trade), pending(f)]);
  assert.equal(results[0].value, "settled");
  assert(
    String(results[1].value?.id) === id ||
      results[1].error?.message.includes("ALREADY_ENTITLED"),
  );
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
});

test("invalid amount cannot be acknowledged through event replay", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  const results = await compete(`zpay-event:${trade}`, [
    settle(id, trade, "notify", 9),
    settle(id, trade),
  ]);
  assert.match(results[0].error.message, /AMOUNT_MISMATCH/);
  assert.equal(results[1].value, "settled");
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
});

test("lock timeout leaves no partial state and retry succeeds", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  const client = await connect("service_role");
  await client.query("set lock_timeout='300ms'");
  await blocker.query("select pg_advisory_lock(hashtextextended($1,0))", [
    `zpay-event:${trade}`,
  ]);
  const result = outcome(client.query(settle(id, trade)));
  try {
    await waitForLocks([client]);
    assert.equal((await result).error.code, "55P03");
  } finally {
    await blocker.query("select pg_advisory_unlock(hashtextextended($1,0))", [
      `zpay-event:${trade}`,
    ]);
  }
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 0,
    rights: 0,
    events: 0,
  });
  assert.equal(
    (await client.query(settle(id, trade))).rows[0].result,
    "settled",
  );
  assert.equal(
    (await client.query(settle(id, trade))).rows[0].result,
    "duplicate",
  );
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
});

test("disconnect before commit rolls back and unblocks another settlement", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  const a = await connect("service_role");
  const b = await connect("service_role");
  await a.query("begin");
  assert.equal((await a.query(settle(id, trade))).rows[0].result, "settled");
  const result = outcome(b.query(settle(id, trade, "reconcile")));
  try {
    await waitForLocks([b]);
  } finally {
    await a.end();
    sessions.delete(a);
  }
  assert.equal((await result).value, "settled");
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
});

test("failure after order update rolls back event/order/entitlement together", async () => {
  const f = await fixture();
  const id = await order(f);
  const trade = randomUUID();
  // Inject a failure at the last INSERT; this constraint exists only in the temporary DB.
  await observer.query(
    `alter table entitlements add constraint concurrency_fail check(user_id<>'${f.user}'::uuid)`,
  );
  const client = await connect("service_role");
  try {
    await assert.rejects(client.query(settle(id, trade)), { code: "23514" });
  } finally {
    await observer.query(
      "alter table entitlements drop constraint concurrency_fail",
    );
  }
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 0,
    rights: 0,
    events: 0,
  });
  assert.equal(
    (await client.query(settle(id, trade))).rows[0].result,
    "settled",
  );
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 1,
    rights: 1,
    events: 1,
  });
});

for (const [field, value] of [
  ["status", "paused"],
  ["price", 12],
]) {
  test(`pending creation revalidates concurrent product ${field} change`, async () => {
    const f = await fixture();
    const client = await connect("service_role");
    await blocker.query("begin");
    await blocker.query(`update articles set ${field}=$1 where id=$2`, [
      value,
      f.target,
    ]);
    const result = outcome(client.query(pending(f)));
    try {
      await waitForLocks([client]);
      await blocker.query("commit");
    } finally {
      await blocker.query("rollback");
    }
    assert.match((await result).error.message, /NOT_SELLABLE/);
    assert.deepEqual(await snapshot(f), {
      orders: 0,
      paid: 0,
      rights: 0,
      events: 0,
    });
  });
}

test("terminal orders reject competing settlement without new events", async () => {
  for (const status of ["failed", "refunded", "fulfilled"]) {
    const f = await fixture();
    const id = await order(f);
    const trade = randomUUID();
    await observer.query("update orders set status=$1 where id=$2", [
      status,
      id,
    ]);
    const results = await compete(`zpay-event:${trade}`, [
      settle(id, trade),
      settle(id, trade, "reconcile"),
    ]);
    assert(
      results.every((r) => r.error?.message.includes("ORDER_NOT_PENDING")),
    );
    assert.deepEqual(await snapshot(f, [trade]), {
      orders: 1,
      paid: 0,
      rights: 0,
      events: 0,
    });
  }
});

test("real PostgreSQL denies client execution of payment authority RPCs", async () => {
  const f = await fixture();
  const id = await order(f);
  for (const role of ["anon", "authenticated"]) {
    const client = await connect(role);
    await assert.rejects(client.query(pending(f)), { code: "42501" });
    await assert.rejects(client.query(settle(id, randomUUID())), {
      code: "42501",
    });
    await assert.rejects(client.query("select claim_email_job()"), {
      code: "42501",
    });
    await assert.rejects(client.query("select * from email_outbox"), {
      code: "42501",
    });
  }
});

test("mail outbox: two PostgreSQL workers skip a held row, then fence an expired lease", async () => {
  // Isolate this test's runnable jobs; no live project or provider is involved.
  await observer.query(
    "update email_outbox set status='dead',lease_token=null,lease_until=null,last_error='provider_rejected' where status<>'sent'",
  );
  const a = await connect("service_role"),
    b = await connect("service_role");
  const f = await fixture(),
    g = await fixture();
  const x = await order(f),
    y = await order(g);
  await a.query(settle(x, randomUUID()));
  await b.query(settle(y, randomUUID()));
  const jobs = (
    await observer.query(
      "select id,order_id from email_outbox where order_id=any($1::bigint[]) order by next_attempt_at,created_at,id",
      [[x, y]],
    )
  ).rows;
  assert.equal(jobs.length, 2);
  await blocker.query("begin");
  await blocker.query("select id from email_outbox where id=$1 for update", [
    jobs[0].id,
  ]);
  let skipped;
  try {
    skipped = (await a.query("select claim_email_job() result")).rows[0].result;
    assert.equal(
      skipped.id,
      jobs[1].id,
      "Locked oldest row must not block another ready job",
    );
    assert.equal(
      (await b.query("select claim_email_job() result")).rows[0].result,
      null,
    );
  } finally {
    await blocker.query("rollback");
  }
  const first = (await b.query("select claim_email_job() result")).rows[0]
    .result;
  assert.equal(first.id, jobs[0].id);
  assert.notEqual(first.id, skipped.id);
  assert.equal(
    (await a.query("select claim_email_job() result")).rows[0].result,
    null,
  );
  await observer.query(
    "update email_outbox set lease_until=now()-interval '1 second' where id=$1",
    [first.id],
  );
  const recovered = (await a.query("select claim_email_job() result")).rows[0]
    .result;
  assert.equal(recovered.id, first.id);
  assert.notEqual(recovered.lease_token, first.lease_token);
  assert.equal(
    (
      await b.query(
        "select finish_email_job($1,$2,'dead','provider_rejected',null) result",
        [first.id, first.lease_token],
      )
    ).rows[0].result,
    false,
  );
  assert.equal(
    (
      await a.query(
        "select finish_email_job($1,$2,'dead','provider_rejected',null) result",
        [recovered.id, recovered.lease_token],
      )
    ).rows[0].result,
    true,
  );
});

test("mail outbox failure rolls back payment inbox and entitlement in real PostgreSQL", async () => {
  const f = await fixture(),
    id = await order(f),
    trade = randomUUID(),
    client = await connect("service_role");
  await observer.query(
    `alter table email_outbox add constraint test_atomic_mail check(order_id<>${Number(id)})`,
  );
  try {
    await assert.rejects(client.query(settle(id, trade)), { code: "23514" });
  } finally {
    await observer.query(
      "alter table email_outbox drop constraint test_atomic_mail",
    );
  }
  assert.deepEqual(await snapshot(f, [trade]), {
    orders: 1,
    paid: 0,
    rights: 0,
    events: 0,
  });
  assert.equal(
    (await client.query(settle(id, trade))).rows[0].result,
    "settled",
  );
  assert.equal(
    (
      await observer.query(
        "select count(*)::int count from email_outbox where order_id=$1",
        [id],
      )
    ).rows[0].count,
    1,
  );
});

test("reference-bound direct/queued settlement captures mail only when queued call grants the right", async () => {
  const f = await fixture(),
    id = await order(f),
    trade = randomUUID();
  const queued = settle(id, trade);
  const legacy = {
    ...queued,
    text: "select settle_payment($1,$2,$3,$4::jsonb) result",
  };
  const results = await compete(`zpay-event:${trade}`, [queued, legacy]);
  assert.deepEqual(results.map((r) => r.value).sort(), [
    "duplicate",
    "settled",
  ]);
  assert.equal(await queueCount(f), results[0].value === "settled" ? 1 : 0);
});

test("export: legacy count-checked pagination can mix equal-count updates", async () => {
  const a = await fixture(),
    b = await fixture();
  const ids = [a.target, b.target];
  await observer.query(
    "update articles set title='Before' where id=any($1::bigint[])",
    [ids],
  );
  let changed = false;
  const rows = await collectExportRows(
    "articles",
    ["id"],
    async (after, includeCount) => {
      if (after !== null && !changed) {
        await blocker.query(
          "update articles set title='After' where id=any($1::bigint[])",
          [ids],
        );
        changed = true;
      }
      const data = (
        await observer.query(
          "select id,title from articles where id=any($1::bigint[]) and ($2::bigint is null or id>$2) order by id limit 1",
          [ids, after],
        )
      ).rows;
      return { data, count: includeCount ? 2 : null };
    },
    async () => ({ count: 2 }),
    1,
  );
  assert.deepEqual(
    rows.map((row) => row.title),
    ["Before", "After"],
    "Reproduce the old non-atomic result despite matching counts",
  );
});

for (const change of ["update", "replace", "payment", "rollback"]) {
  test(
    `export: one MVCC snapshot survives concurrent ${change}`,
    { timeout: 15000 },
    async () => {
      const f = await fixture(),
        id = await order(f);
      const skill = await fixture("skill");
      await observer.query(
        "insert into article_bodies(article_id,content) values($1,'Before body')",
        [f.target],
      );
      const reader = await connect("service_role");
      assert.notEqual(reader.backendPid, blocker.backendPid);
      const read = async () =>
        parseExportSnapshot(
          (
            await reader.query(
              "select public.export_site_snapshot(true,true) result",
            )
          ).rows[0].result,
        );
      const before = await read();
      // SECURITY DEFINER SQL functions cannot inline. The outer SELECT establishes its
      // snapshot before the STABLE function waits for this table lock. No production pause hook.
      await blocker.query(
        "begin; lock table public.article_bodies in access exclusive mode",
      );
      const inFlight = read().then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      try {
        const deadline = Date.now() + 5000;
        let waiting = false;
        while (Date.now() < deadline) {
          const activity = await observer.query(
            "select state,wait_event_type,$2::int=any(pg_blocking_pids(pid)) blocked from pg_stat_activity where pid=$1",
            [reader.backendPid, blocker.backendPid],
          );
          if (
            activity.rows[0]?.state === "active" &&
            activity.rows[0]?.wait_event_type === "Lock" &&
            activity.rows[0]?.blocked
          ) {
            waiting = true;
            break;
          }
          await delay(15);
        }
        assert(
          waiting,
          "Export must demonstrably overlap the independent writer",
        );
        if (change === "replace") {
          await blocker.query("delete from orders where id=$1", [id]);
          await blocker.query(
            "insert into orders(user_id,sku_type,target_id,amount) values($1,'single',$2,10)",
            [f.user, f.target],
          );
        } else if (change === "payment") {
          await blocker.query(settle(id, randomUUID()));
        } else {
          await blocker.query(
            "update articles set title='After title' where id=$1",
            [f.target],
          );
          await blocker.query(
            "update article_bodies set content='After body' where article_id=$1",
            [f.target],
          );
          await blocker.query(
            "update auth.users set email='after@example.test' where id=$1",
            [f.user],
          );
          await blocker.query("update skills set price=11 where id=$1", [skill.target]);
        }
        await blocker.query(change === "rollback" ? "rollback" : "commit");
      } finally {
        await blocker.query("rollback");
      }
      const completed = await inFlight;
      assert.ifError(completed.error);
      assert.deepEqual(
        completed.value.rows,
        before.rows,
        "All exported tables, including Skills, must retain the pre-commit snapshot",
      );
      assert.deepEqual(
        completed.value.users,
        before.users,
        "Auth profiles must share the application snapshot",
      );
      const after = await read();
      if (change === "rollback") {
        assert.deepEqual(after.rows, before.rows);
        assert.deepEqual(after.users, before.users);
      } else {
        assert.notDeepEqual(
          after.rows,
          before.rows,
          "A new export sees the committed state",
        );
        if (change === "update") assert.notDeepEqual(after.users, before.users);
        if (change === "payment") {
          assert.equal(
            after.rows.orders.find((row) => String(row.id) === String(id))
              .status,
            "paid",
          );
          assert.equal(
            after.rows.email_outbox.filter(
              (row) => String(row.order_id) === String(id),
            ).length,
            1,
          );
          assert.equal(
            after.rows.entitlements.filter((row) => row.user_id === f.user)
              .length,
            1,
          );
        }
      }
    },
  );
}

const reserveAvatar = (user, requestId = randomUUID()) => ({
  text: "select reserve_avatar_generation($1,$2,null,'concurrency-model') result",
  values: [requestId, user],
});

test(
  "media upload reservations serialize duplicate attempts and protect the rolling station limit",
  { timeout: 15000 },
  async () => {
    const existing = (
      await observer.query("select id from profiles where is_owner")
    ).rows[0];
    const owner = existing?.id ?? randomUUID(),
      upload = randomUUID(),
      digest = "a".repeat(64);
    if (!existing) {
      await observer.query(
        "insert into auth.users(id,email) values($1,'media-owner@example.test')",
        [owner],
      );
      await observer.query("update profiles set is_owner=true where id=$1", [
        owner,
      ]);
    }
    const call = {
      text: "select reserve_media_upload($1,$2,'same.png',$3,'image/png',100) result",
      values: [upload, owner, digest],
    };
    const replay = await compete(
      `media-upload:${owner}`,
      Array.from({ length: 8 }, () => call),
    );
    assert(replay.every((row) => !row.error && row.value.id === upload));
    assert.equal(replay.filter((row) => row.value.resumed === false).length, 1);
    assert.equal(
      (
        await observer.query(
          "select count(*)::int n from media_uploads where owner_id=$1",
          [owner],
        )
      ).rows[0].n,
      1,
    );
    await observer.query(
      "insert into media_uploads(id,owner_id,name,source_hash,mime_type,byte_size) select gen_random_uuid(),$1,'fixture',$2,'image/png',100 from generate_series(1,598)",
      [owner, digest],
    );
    const lastSlot = await compete(
      `media-upload:${owner}`,
      Array.from({ length: 8 }, () => ({
        ...call,
        values: [randomUUID(), owner, digest],
      })),
    );
    assert.equal(lastSlot.filter((row) => !row.error).length, 1);
    assert.equal(
      lastSlot.filter((row) => row.error?.message.includes("UPLOAD_RATE_LIMIT"))
        .length,
      7,
    );
  },
);

test(
  "avatar quota: eight workers competing for the final daily slot admit exactly one",
  { timeout: 15000 },
  async () => {
    const f = await fixture("single");
    await observer.query(
      `update site_config set avatar_config='{"enabled":true,"monthly_limit":null}'::jsonb`,
    );
    await observer.query(
      "insert into avatar_usage(user_id,model) select $1,'legacy' from generate_series(1,19)",
      [f.user],
    );
    const results = await compete(
      "avatar-quota",
      Array.from({ length: 8 }, () => reserveAvatar(f.user)),
    );
    assert(results.every((r) => !r.error));
    assert.equal(results.filter((r) => r.value === "reserved").length, 1);
    assert.equal(results.filter((r) => r.value === "daily_limit").length, 7);
    assert.equal(
      (
        await observer.query(
          "select count(*)::int n from avatar_usage where user_id=$1",
          [f.user],
        )
      ).rows[0].n,
      20,
    );
  },
);

test(
  "avatar quota: station cap spans users; a replay dispatches at most once",
  { timeout: 15000 },
  async () => {
    const users = await Promise.all(
      Array.from({ length: 6 }, () => fixture("single")),
    );
    const used = (
      await observer.query(
        "select count(*)::int n from avatar_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>now())",
      )
    ).rows[0].n;
    await observer.query(
      "update site_config set avatar_config=jsonb_build_object('enabled',true,'monthly_limit',$1::int)",
      [used + 1],
    );
    const calls = users.map((f) => reserveAvatar(f.user));
    const results = await compete("avatar-quota", calls);
    assert(results.every((r) => !r.error));
    assert.equal(results.filter((r) => r.value === "reserved").length, 1);
    assert.equal(results.filter((r) => r.value === "monthly_limit").length, 5);
    const winning = calls[results.findIndex((r) => r.value === "reserved")];
    const dispatches = await compete(
      "avatar-quota",
      Array.from({ length: 4 }, () => ({
        text: "select dispatch_avatar_generation($1) result",
        values: [winning.values[0]],
      })),
    );
    assert(dispatches.every((r) => !r.error));
    assert.equal(dispatches.filter((r) => r.value === true).length, 1);
    assert.equal(dispatches.filter((r) => r.value === false).length, 3);
  },
);

test("Turnstile settings: concurrent owner saves keep one matching public/private pair", { timeout: 15000 }, async () => {
  let owner = (await observer.query("select id from profiles where is_owner")).rows[0]?.id;
  if (!owner) {
    owner = randomUUID();
    await observer.query("insert into auth.users(id,email) values($1,'security-owner@example.test')", [owner]);
    await observer.query("update profiles set is_owner=true where id=$1", [owner]);
  }
  const expected = (await observer.query("select updated_at::text value from site_config where id=1")).rows[0].value;
  const clients = await Promise.all([connect("authenticated"), connect("authenticated")]);
  for (const client of clients) await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner })]);
  await blocker.query("begin;select id from site_config where id=1 for update");
  const pending = clients.map((client, index) => client.query(
    "select save_turnstile_settings($1::timestamptz,true,$2,$3,false)",
    [expected, `synthetic-race-site-${index}`, `synthetic-race-secret-${index}`],
  ).then(() => ({ index, error: null }), error => ({ index, error: error.message })));
  try { await waitForLocks(clients); }
  finally { await blocker.query("commit"); }
  const results = await Promise.all(pending);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal(results.filter(result => result.error?.includes("SETTINGS_CONFLICT")).length, 1);
  const winner = results.find(result => !result.error).index;
  const stored = (await observer.query("select s.turnstile_config->>'site_key' site_key,k.value secret_key from site_config s cross join site_secrets k where s.id=1 and k.key='turnstile_secret_key'")).rows[0];
  assert.equal(stored.site_key, `synthetic-race-site-${winner}`);
  assert.equal(stored.secret_key, `synthetic-race-secret-${winner}`);
});

async function ensureAITestSettings() {
  let owner = (await observer.query("select id from profiles where is_owner")).rows[0]?.id;
  if (!owner) {
    owner = randomUUID();
    await observer.query("insert into auth.users(id,email) values($1,'ai-owner@example.test')", [owner]);
    await observer.query("update profiles set is_owner=true where id=$1", [owner]);
  }
  const revision = (await observer.query("select revision from ai_settings where id=1")).rows[0].revision;
  await observer.query("select save_ai_settings($1,$2,$3,$4,$5,$6,false,$7)", [owner, revision,
    { purpose: "generation", protocol: "chat", baseUrl: "https://api.deepseek.com", model: "synthetic-model" }, "synthetic-generation-key",
    { purpose: "embedding", protocol: "embeddings", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3" }, "synthetic-embedding-key",
    { enabled: false, anonymousEntry: false, instructions: "synthetic test", monthlyLimit: null }]);
  return owner;
}

test("AI configuration CAS: independent owner saves commit only one complete connection pair", { timeout: 15000 }, async () => {
  const owner = await ensureAITestSettings();
  const expected = (await observer.query("select revision from ai_settings where id=1")).rows[0].revision;
  const clients = await Promise.all([connect("service_role"), connect("service_role")]);
  await blocker.query("begin; select id from ai_settings where id=1 for update");
  const pending = clients.map((client, index) => client.query("select save_ai_settings($1,$2,$3,$4,$5,$6,false,$7)", [
    owner, expected, { purpose: "generation", protocol: "chat", baseUrl: "https://api.deepseek.com", model: "synthetic-model" }, `synthetic-generation-${index}`,
    { purpose: "embedding", protocol: "embeddings", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3" }, `synthetic-embedding-${index}`,
    { enabled: false, anonymousEntry: false, instructions: `synthetic rule ${index}`, monthlyLimit: null },
  ]).then(() => ({ index, error: null }), error => ({ index, error: error.message })));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  const results = await Promise.all(pending);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert.equal(results.filter(result => result.error?.includes("SETTINGS_CONFLICT")).length, 1);
  const winner = results.find(result => !result.error).index;
  const selected = (await observer.query("select g.api_key gen,e.api_key emb,s.owner_instructions from ai_settings s join ai_connections g on g.id=s.generation_connection join ai_connections e on e.id=s.embedding_connection")).rows[0];
  assert.equal(selected.gen, `synthetic-generation-${winner}`); assert.equal(selected.emb, `synthetic-embedding-${winner}`);
  assert.equal(selected.owner_instructions, `synthetic rule ${winner}`);
});

test("AI monthly budget and dispatch are single-winner authorities across real backends", { timeout: 15000 }, async () => {
  const owner = await ensureAITestSettings();
  const connection = (await observer.query("select generation_connection id from ai_settings")).rows[0].id;
  await observer.query("update ai_connections set verified_at=now() where id=$1", [connection]);
  const used = Number((await observer.query(`select
    (select count(*) from avatar_usage where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and generation_state<>'released' and (generation_state<>'reserved' or reservation_expires_at>now())) +
    (select count(*) from ai_calls where created_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' and task in ('avatar','page') and state<>'released' and (state<>'reserved' or expires_at>now())) n`)).rows[0].n);
  await observer.query("update ai_settings set monthly_limit=$1", [used + 1]);
  const calls = Array.from({ length: 4 }, () => ({ text: "select reserve_ai_call($1,'page',$2,$3,null) result", values: [randomUUID(), connection, owner] }));
  const results = await compete("ai-call-budget", calls);
  assert(results.every(result => !result.error));
  assert.equal(results.filter(result => result.value === "reserved").length, 1);
  assert.equal(results.filter(result => result.value === "monthly_limit").length, 3);
  const request = calls[results.findIndex(result => result.value === "reserved")].values[0];
  const clients = await Promise.all([connect("service_role"), connect("service_role")]);
  await blocker.query("begin");
  await blocker.query("select request_id from ai_calls where request_id=$1 for update", [request]);
  const dispatches = clients.map(client => client.query("select dispatch_ai_call($1) ok", [request]));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  const dispatched = await Promise.all(dispatches);
  assert.equal(dispatched.filter(result => result.rows[0].ok).length, 1);
  assert.equal((await observer.query("select finish_ai_call($1,'released') ok", [request])).rows[0].ok, false);
});

test("Knowledge workers claim disjoint real rows and stale provider responses cannot revive revised content", { timeout: 20000 }, async () => {
  const owner = await ensureAITestSettings();
  const connection = (await observer.query("select embedding_connection id from ai_settings")).rows[0].id;
  await observer.query("update ai_connections set verified_at=now() where id=$1", [connection]);
  const article = (await observer.query("insert into articles(slug,title,type,access,status,published_at) values($1,'Synthetic long source','blog','public','published',now()) returning id", [randomUUID()])).rows[0].id;
  await observer.query("insert into article_chunks(article_id,access,chunk_type,chunk_no,content) values($1,'public','body',0,$2)", [article, "汉🙂".repeat(14000)]);
  const id = (await observer.query("select begin_knowledge_index($1,true) id", [owner])).rows[0].id;
  for (const source of (await observer.query("select * from knowledge_sources order by source_key")).rows) await observer.query("select register_knowledge_source($1,$2,$3,$4)", [id, source.source_key, source.source_hash, JSON.stringify(knowledgeParts(source.content))]);
  assert.equal((await observer.query("select complete_knowledge_scan($1) ok", [id])).rows[0].ok, true);
  const clients = await Promise.all([connect("service_role"), connect("service_role")]);
  const leases = [randomUUID(), randomUUID()];
  await blocker.query("begin; select id from knowledge_index_control where id=1 for update");
  const pending = clients.map((client, index) => client.query("select * from claim_knowledge_batch($1,$2)", [id, leases[index]]));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  const batches = (await Promise.all(pending)).map(result => result.rows);
  assert.equal(batches[0].length, 16); assert.equal(batches[1].length, 16);
  assert(!batches[0].some(item => batches[1].some(other => item.item_id === other.item_id)));
  const vectors = batches[0].map(item => ({ id: item.item_id, vector: Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0) }));
  await observer.query("update article_chunks set content=content||' revised' where article_id=$1", [article]);
  assert.equal((await observer.query("select finish_knowledge_batch($1,$2,$3) ok", [id, leases[0], JSON.stringify(vectors)])).rows[0].ok, true);
  assert.equal(Number((await observer.query("select count(*) n from knowledge_index_items i join knowledge_sources s on s.source_key=i.source_key where i.generation_id=$1 and i.state='ready' and i.source_hash<>s.source_hash", [id])).rows[0].n), 0);
  await observer.query("update knowledge_index_items set lease_expires_at=now()-interval '1 second' where lease_id=$1", [leases[1]]);
  assert.equal((await observer.query("select finish_knowledge_batch($1,$2,$3) ok", [id, leases[1], JSON.stringify(batches[1].map((item, i) => ({ ...vectors[i], id: item.item_id })))])).rows[0].ok, false);
});

test("Incremental candidate creation has one winner and old active vectors remain isolated", { timeout: 20000 }, async () => {
  const owner = await ensureAITestSettings();
  const connection = (await observer.query("select embedding_connection id from ai_settings")).rows[0].id;
  await observer.query("update ai_connections set verified_at=now() where id=$1", [connection]);
  await observer.query("delete from knowledge_index_generations where state<>'active'");
  const epoch = Number((await observer.query("select source_revision n from knowledge_index_control where id=1")).rows[0].n);
  // A synthetic pre-existing active generation, with no network calls, isolates the
  // task authority race from the already-covered embedding/evaluation pipeline.
  await observer.query("update knowledge_index_control set active_generation=null where id=1");
  await observer.query("delete from knowledge_index_generations");
  const active = (await observer.query("insert into knowledge_index_generations(connection_id,created_by,state,approved_revision) values($1,$2,'active',$3) returning id", [connection, owner, epoch])).rows[0].id;
  await observer.query("update knowledge_index_control set active_generation=$1 where id=1", [active]);
  const calls = Array.from({ length: 3 }, () => ({ text: "select start_knowledge_task($1,'sync',true,$2,$3) result", values: [owner, epoch, connection] }));
  const clients = await Promise.all(calls.map(() => connect("service_role")));
  await blocker.query("begin");
  await blocker.query("select id from knowledge_index_control where id=1 for update");
  const pending = clients.map((client, index) => outcome(client.query(calls[index])));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  const results = await Promise.all(pending);
  assert.equal(results.filter(result => !result.error).length, 1);
  assert(results.filter(result => result.error).every(result => /KNOWLEDGE_BUILD_EXISTS/.test(result.error)));
  const generations = (await observer.query("select id,state,base_generation from knowledge_index_generations order by state")).rows;
  assert.equal(generations.length, 2);
  assert.equal(generations.find(row => row.state === "building").base_generation, active);
  assert.equal((await observer.query("select active_generation from knowledge_index_control where id=1")).rows[0].active_generation, active);
  assert.equal(Number((await observer.query("select count(*) n from knowledge_index_items where generation_id=$1", [active])).rows[0].n), 0);
});

test("Question draft leases have one winner and reject superseded worker responses", { timeout: 15000 }, async () => {
  const generation = (await observer.query("select id,approved_revision from knowledge_index_generations where state='building' order by created_at desc limit 1")).rows[0];
  const connection = (await observer.query("select generation_connection id from ai_settings where id=1")).rows[0].id;
  const draft = randomUUID();
  await observer.query("insert into knowledge_question_drafts(id,generation_id,source_revision,connection_id,manifest) values($1,$2,$3,$4,$5)",
    [draft, generation.id, generation.approved_revision, connection, JSON.stringify([{ id: randomUUID(), target: "article:synthetic", title: "Synthetic source" }])]);
  await assert.rejects(observer.query("insert into knowledge_question_drafts(id,generation_id,source_revision,connection_id,manifest) select $1,generation_id,source_revision,connection_id,manifest from knowledge_question_drafts where id=$2", [randomUUID(), draft]), error => error.code === "23505");
  const clients = await Promise.all([connect("service_role"), connect("service_role")]);
  const leases = [randomUUID(), randomUUID()];
  await blocker.query("begin");
  await blocker.query("select id from knowledge_question_drafts where id=$1 for update", [draft]);
  const pending = clients.map((client, index) => client.query("update knowledge_question_drafts set state='leased',lease_id=$2,lease_expires_at=clock_timestamp()+interval '90 seconds' where id=$1 and state='pending' returning id", [draft, leases[index]]));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  const claimed = await Promise.all(pending);
  assert.equal(claimed.reduce((count, result) => count + result.rowCount, 0), 1);
  const oldLease = leases[claimed.findIndex(result => result.rowCount === 1)];
  await observer.query("update knowledge_question_drafts set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1", [draft]);
  assert.equal((await clients[0].query("update knowledge_question_drafts set state='complete',lease_id=null,lease_expires_at=null where id=$1 and lease_id=$2 and lease_expires_at>clock_timestamp() returning id", [draft, oldLease])).rowCount, 0);
  const replacement = randomUUID();
  await observer.query("update knowledge_question_drafts set lease_id=$2,lease_expires_at=clock_timestamp()+interval '90 seconds' where id=$1", [draft, replacement]);
  assert.equal((await clients[0].query("update knowledge_question_drafts set state='complete',lease_id=null,lease_expires_at=null where id=$1 and lease_id=$2 and lease_expires_at>clock_timestamp() returning id", [draft, oldLease])).rowCount, 0);
  assert.equal((await clients[1].query("update knowledge_question_drafts set state='complete',lease_id=null,lease_expires_at=null where id=$1 and lease_id=$2 and lease_expires_at>clock_timestamp() returning id", [draft, replacement])).rowCount, 1);
});

test("Owner activation rejects a content revision committed while confirmation waits", { timeout: 20000 }, async () => {
  const owner = await ensureAITestSettings();
  const connection = (await observer.query("select embedding_connection id from ai_settings where id=1")).rows[0].id;
  await observer.query("update ai_connections set verified_at=now() where id=$1", [connection]);
  await observer.query("delete from knowledge_index_generations where state<>'active'");
  const id = (await observer.query("select begin_knowledge_index($1,true) id", [owner])).rows[0].id;
  for (const source of (await observer.query("select * from knowledge_sources order by source_key")).rows) {
    await observer.query("select register_knowledge_source($1,$2,$3,$4)", [id, source.source_key, source.source_hash, JSON.stringify(knowledgeParts(source.content))]);
  }
  await observer.query("select complete_knowledge_scan($1)", [id]);
  // Provider outputs are synthetic and written only in this disposable database.
  await observer.query("update knowledge_index_items set embedding=$2::extensions.vector,state='ready' where generation_id=$1 and state='pending'", [id, JSON.stringify([1, ...Array(1023).fill(0)])]);
  const revision = Number((await observer.query("select source_revision from knowledge_index_control where id=1")).rows[0].source_revision);
  const client = await connect("service_role");
  await blocker.query("begin");
  await blocker.query("update article_chunks set content=content||' newer source' where id=(select min(id) from article_chunks)");
  const pending = outcome(client.query("select enable_knowledge_index($1,$2,$3,$4,true) result", [owner, id, revision, connection]));
  try { await waitForLocks([client]); } finally { await blocker.query("commit"); }
  const result = await pending;
  assert.match(result.error?.message ?? "", /KNOWLEDGE_SOURCE_CHANGED/);
  const candidate = (await observer.query("select state,accepted_at from knowledge_index_generations where id=$1", [id])).rows[0];
  assert.notEqual(candidate.state, "active"); assert.equal(candidate.accepted_at, null);
});

test("Skill confirmation and settings races preserve one immutable release and one winning revision", async () => {
  const owner = await ensureAITestSettings(); const f = await fixture("skill"); const upload = randomUUID();
  await observer.query("select reserve_skill_upload($1,$2,$3,'2.0.0','Update',$4,10)", [upload, f.target, owner, "b".repeat(64)]);
  const clients = await Promise.all([connect("service_role"), connect("service_role")]);
  await blocker.query("begin"); await blocker.query("select id from skill_uploads where id=$1 for update", [upload]);
  const claims = clients.map(c => c.query("select claim_skill_confirmation($1,$2) result", [upload, owner]));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  assert.deepEqual((await Promise.all(claims)).map(r => r.rows[0].result).sort(), [false, true]);
  await blocker.query("begin"); await blocker.query("select id from skill_uploads where id=$1 for update", [upload]);
  const confirms = clients.map(c => c.query("select confirm_skill_release($1,$2,$3,'synthetic-skill','Synthetic',true) result", [upload, owner, skillManifest]));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  assert.deepEqual((await Promise.all(confirms)).map(r => r.rows[0].result), [upload, upload]);
  assert.equal((await observer.query("select count(*)::int n from skill_releases where skill_id=$1 and version='2.0.0'", [f.target])).rows[0].n, 1);
  const revision = (await observer.query("select revision from skills where id=$1", [f.target])).rows[0].revision;
  await blocker.query("begin"); await blocker.query("select id from skills where id=$1 for update", [f.target]);
  const saves = clients.map((c, i) => outcome(c.query("select save_skill_settings($1,$2,$3,$4,$5,true,'Guide') result", [f.target, owner, revision, i + 20, upload])));
  try { await waitForLocks(clients); } finally { await blocker.query("commit"); }
  const saved = await Promise.all(saves); assert.equal(saved.filter(r => !r.error).length, 1);
  assert.match(saved.find(r => r.error)?.error.message ?? "", /SETTINGS_CONFLICT/);
});

test("Skill turn replay dispatches once and different concurrent turns are blocked", async () => {
  const owner = await ensureAITestSettings(); const f = await fixture("skill"); const session = randomUUID(), turn = randomUUID();
  const call = { text: "select begin_skill_turn($1,$2,$3,$4,'Question') result", values: [owner, f.target, session, turn] };
  const results = await compete(`skill-turn:${owner}`, [call, call, call]);
  assert(results.every(r => !r.error)); assert.equal(results.filter(r => r.value.new).length, 1);
  const next = await compete(`skill-turn:${owner}`, [1, 2].map(() => ({ ...call, values: [owner, f.target, session, randomUUID()] })));
  assert(next.every(r => /TURN_RUNNING/.test(r.error?.message ?? "")));
  assert.equal((await observer.query("select count(*)::int n from skill_turns where session_id=$1", [session])).rows[0].n, 1);
});

test("Handbook operation races replay the same result and reject changed content", async () => {
  const owner = await ensureAITestSettings(); const credential = (await observer.query("select create_handbook_credential($1,'Concurrent',$2) id", [owner, randomUUID().replaceAll("-", "").repeat(2)])).rows[0].id;
  const operation = randomUUID(), slug = `sync-${randomUUID()}`;
  const call = { text: "select create_synced_handbook($1,$2,$3,$4,'Concurrent Handbook') result", values: [credential, operation, "a".repeat(64), slug] };
  const results = await compete(`handbook-operation:${operation}`, [call, call, call]);
  assert(results.every(r => !r.error)); assert.equal(new Set(results.map(r => r.value.id)).size, 1);
  assert.equal((await observer.query("select count(*)::int n from series where slug=$1", [slug])).rows[0].n, 1);
  const client = await connect("service_role");
  await assert.rejects(client.query(call.text, [credential, operation, "b".repeat(64), slug]), /OPERATION_CONFLICT/);
  await observer.query("update handbook_credentials set revoked_at=now() where id=$1", [credential]);
  await assert.rejects(client.query(call), /CREDENTIAL_REVOKED/);
});


test("whole-series duplicate publication races return one atomic result and one version per chapter", async () => {
  const slug = `batch-${randomUUID()}`;
  const s = (await observer.query("insert into series(slug,type,title,status) values($1,'handbook','Batch concurrency','draft') returning id,updated_at::text", [slug])).rows[0];
  const payloads=[];
  for (const name of ["readme","chapter"]) {
    const request=randomUUID();
    const snapshot={frontmatter:{title:name,slug:`${slug}-${name}`,type:"chapter",series_slug:slug,access:name==="readme"?"public":"paid"},markdown:"Preview\n\n<!-- paywall -->\n\nPRIVATE_BATCH",media:[]};
    const payload=await preparePublication({client_request_id:request,...snapshot},{download:async()=>null,upload:async()=>{},publicUrl:p=>p});
    const id=(await observer.query("select stage_content_file($1,$2,$3,$4,$5,0,$6) id",[`series:${slug}`,name+".md",snapshot.frontmatter.slug,createHash("sha256").update(request).digest("hex"),snapshot,request])).rows[0].id;
    payloads.push({id,payload});
  }
  const request=randomUUID();const clients=await Promise.all([connect("service_role"),connect("service_role")]);
  await blocker.query("select pg_advisory_lock(71001,hashtext($1))",[`series-batch:${request}`]);
  const call={text:"select commit_series_publication($1,$2,$3,$4,true,$5) result",values:[s.id,s.updated_at,request,JSON.stringify(payloads),`${slug}-readme`]};
  const pending=clients.map(c=>outcome(c.query(call)));
  try { await waitForLocks(clients); } finally { await blocker.query("select pg_advisory_unlock(71001,hashtext($1))",[`series-batch:${request}`]); }
  const results=await Promise.all(pending);
  assert(results.every(r=>!r.error),results.map(r=>r.error?.message).join(";"));assert.deepEqual(results[0].value,results[1].value);
  const count=(await observer.query("select count(*)::int count from article_versions where article_id in(select id from articles where series_id=$1)",[s.id])).rows[0].count;
  assert.equal(count,2);
  assert.equal((await observer.query("select status from series where id=$1",[s.id])).rows[0].status,"published");
});
