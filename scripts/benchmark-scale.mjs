import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import {
  collectExportRows,
  collectExportUsers,
  EXPORT_TABLES,
  exportCursorColumns,
} from "../src/lib/admin/export-pagination.ts";
import { buildSiteExportArchive } from "../src/lib/admin/export-archive.ts";
import { deriveUserRows } from "../src/lib/admin/users-derive.ts";
import { summarizeDashboard } from "../src/lib/admin/dashboard-metrics.ts";
import { parseExportSnapshot } from "../src/lib/admin/export-snapshot.ts";
import { inspectExportZip } from "./check-export-zip.mjs";

// No .env loading, no hosted database, no network APIs. Only this process's random database is dropped.
const embedded = process.argv.includes("--pglite");
const reportPath = process.env.SCALE_REPORT_PATH;
const started = performance.now();
const heartbeat = setInterval(
  () =>
    console.log(
      `SCALE running ${Math.round((performance.now() - started) / 1000)}s`,
    ),
  15000,
);
const deadline = setTimeout(() => {
  console.error("SCALE exceeded 180s hard deadline");
  process.exit(1);
}, 180000);
let db;
let admin;
let created = false;
const database = `wanyou_scale_${randomUUID().replaceAll("-", "")}`;
const sql = async (name) =>
  readFile(new URL(`../supabase/${name}`, import.meta.url), "utf8");
let query;
let exec;
const normalize = (rows) => JSON.parse(JSON.stringify(rows));
const now = new Date("2026-10-08T12:00:00Z");
const userId = (id) =>
  `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
const metrics = [];
const plans = [];

async function measure(name, run, validate, samples = 9) {
  validate(await run()); // warm-up and correctness are mandatory, not just timing
  const times = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    const result = await run();
    times.push(performance.now() - start);
    validate(result);
  }
  times.sort((a, b) => a - b);
  const row = {
    name,
    samples,
    median_ms: +times[Math.floor(samples / 2)].toFixed(2),
    p95_ms: +times[Math.ceil(samples * 0.95) - 1].toFixed(2),
  };
  metrics.push(row);
  console.log(`SCALE ${JSON.stringify(row)}`);
}

async function explain(name, statement, values = []) {
  const rows = await query(
    `explain (analyze, buffers, format json) ${statement}`,
    values,
  );
  const plan = rows[0]["QUERY PLAN"][0];
  plans.push({ name, ...plan });
}

try {
  if (embedded) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { vector } = await import("@electric-sql/pglite-pgvector");
    db = new PGlite({ extensions: { vector } });
    query = async (text, values = []) =>
      normalize((await db.query(text, values)).rows);
    exec = async (text) => {
      await db.exec(text);
    };
    await exec(
      "create role anon; create role authenticated; create role service_role bypassrls",
    );
  } else {
    const connectionString = process.env.TEST_DATABASE_URL;
    assert(
      connectionString,
      "Set TEST_DATABASE_URL to a disposable localhost PostgreSQL; see docs/development/scale-performance.md",
    );
    const url = new URL(connectionString);
    assert(
      ["postgres:", "postgresql:"].includes(url.protocol) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        !url.search &&
        !url.hash,
      "Only localhost PostgreSQL is accepted",
    );
    const { default: pg } = await import("pg");
    // This fixture uses small identity values; preserve identical numeric IDs across the two engines.
    pg.types.setTypeParser(20, Number);
    admin = new pg.Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    await admin.connect();
    const info = (
      await admin.query(
        "select current_setting('server_version_num')::int version, rolsuper from pg_roles where rolname=current_user",
      )
    ).rows[0];
    assert(
      info.rolsuper && info.version >= 170000,
      "Disposable PostgreSQL 17+ administrator required",
    );
    for (const [role, bypass] of [
      ["anon", false],
      ["authenticated", false],
      ["service_role", true],
    ]) {
      const rows = (
        await admin.query(
          "select rolsuper,rolbypassrls from pg_roles where rolname=$1",
          [role],
        )
      ).rows;
      if (rows.length)
        assert(
          !rows[0].rolsuper && rows[0].rolbypassrls === bypass,
          "Existing role attributes differ",
        );
      else
        await admin.query(`create role ${role}${bypass ? " bypassrls" : ""}`);
    }
    await admin.query(`create database ${database}`);
    created = true;
    url.pathname = `/${database}`;
    db = new pg.Client({
      connectionString: url.href,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    await db.connect();
    query = async (text, values = []) =>
      normalize((await db.query(text, values)).rows);
    exec = async (text) => {
      await db.query(text);
    };
    await exec("set statement_timeout='10s'; set lock_timeout='5s'");
  }
  await exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key, email text, email_confirmed_at timestamptz,
      aud text, role text, raw_user_meta_data jsonb, raw_app_meta_data jsonb,
      created_at timestamptz not null default now()
    );
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to public;
  `);
  const install = await sql("install.sql");
  await exec(install);
  const checks = await query(await sql("verify.sql"));
  // verify.sql grows with migrations; validate every result, not a stale row count.
  assert(checks.length > 0, "Install verification returned no checks");
  assert(
    checks.every((row) => row.passed === true),
    "Install verification failed",
  );
  console.log(
    `SCALE install verify ${checks.length}/${checks.length}; seeding synthetic data`,
  );
  await exec(`
    insert into auth.users(id,email,created_at)
      select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
        'scale-'||n||'@example.test', '2026-10-01T00:00:00Z'::timestamptz from generate_series(1,1000) n;
    update profiles set is_owner=true where id='${userId(1)}';
    insert into articles(slug,type,title,access,price,status,published_at)
      select 'scale-'||n,'blog','Scale article '||n,case when n%2=0 then 'public' else 'paid' end,
        case when n%2=0 then null else 10 end,'published','2026-10-01T00:00:00Z'::timestamptz + n*interval '1 minute'
        from generate_series(1,1000) n;
    insert into article_bodies(article_id,content) select id,repeat('synthetic-body-',585) from articles;
    insert into orders(user_id,sku_type,target_id,amount,status,created_at,updated_at)
      select ('00000000-0000-4000-8000-'||lpad(((n-1)%1000+1)::text,12,'0'))::uuid,
        'single',((n-1)%500)*2+1,10,'paid','2026-10-02T00:00:00Z','2026-10-02T00:00:00Z'
        from generate_series(1,10000) n;
    insert into entitlements(user_id,type,target_id,created_at)
      select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'single',n*2-1,'2026-10-02T00:00:00Z'
        from generate_series(1,500) n;
    analyze;
  `);
  const counts = (
    await query(`select (select count(*)::int from auth.users) users,
    (select count(*)::int from articles) articles,(select count(*)::int from orders) orders,
    (select count(*)::int from entitlements) entitlements`)
  )[0];
  assert.deepEqual(counts, {
    users: 1000,
    articles: 1000,
    orders: 10000,
    entitlements: 500,
  });

  // Same predicates/projection as getBlogArticles; SQL timing excludes SSR and public internet.
  const listSql =
    "select id,slug,title,summary,cover_url,tags,access,price,published_at from articles where type='blog' and status='published' order by published_at desc";
  await exec("set role anon");
  await measure(
    "anon-blog-metadata-1000",
    () => query(listSql),
    (rows) => {
      assert.equal(rows.length, 1000);
      assert(!Object.hasOwn(rows[0], "content"));
    },
  );
  await explain("anon-blog-metadata-1000", listSql);
  const bodiesSql = "select article_id from article_bodies order by article_id";
  await measure(
    "anon-body-rls",
    () => query(bodiesSql),
    (rows) => {
      assert.equal(rows.length, 500);
      assert(rows.every((r) => r.article_id % 2 === 0));
    },
  );
  await explain("anon-body-rls", bodiesSql);
  await exec("reset role; set role authenticated");
  await query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: userId(2) }),
  ]);
  await measure(
    "buyer-body-rls",
    () => query(bodiesSql),
    (rows) => {
      assert.equal(rows.length, 501);
      assert(rows.every((r) => r.article_id % 2 === 0 || r.article_id === 3));
    },
  );
  await explain("buyer-body-rls", bodiesSql);
  await measure(
    "buyer-own-orders",
    () => query("select id,amount,status from orders order by created_at desc"),
    (rows) => assert.equal(rows.length, 10),
  );
  await query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: userId(1000) }),
  ]);
  assert.equal(
    (await query(bodiesSql)).length,
    500,
    "Unentitled user cannot read paid bodies",
  );
  await query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: userId(1) }),
  ]);
  await measure(
    "owner-paid-orders-page",
    () =>
      query(
        "select id,amount,updated_at from orders where status in ('paid','fulfilled') and updated_at >= $1 order by id limit 500",
        ["2026-10-01T00:00:00Z"],
      ),
    (rows) => assert.equal(rows.length, 500),
  );
  await explain(
    "owner-paid-orders-page",
    "select id,amount,updated_at from orders where status in ('paid','fulfilled') and updated_at >= '2026-10-01T00:00:00Z' order by id limit 500",
  );
  await exec("reset role; reset request.jwt.claims");

  // Exercise the production pagination with a deliberately lower database adapter cap (137).
  // This is not PostgREST/Auth HTTP: SDK request shape/capped responses have separate unit coverage.
  let pages = 0;
  async function readTable(table) {
    const keys = exportCursorColumns(table);
    const columns = keys.map((key) => `"${key}"`).join(",");
    return collectExportRows(
      table,
      keys,
      async (after, includeCount, size) => {
        pages++;
        const values =
          after === null ? [] : keys.length === 1 ? [after] : JSON.parse(after);
        const predicate =
          after === null
            ? ""
            : `where (${columns}) > (${keys.map((_, i) => `$${i + 1}`).join(",")})`;
        const data = await query(
          `select * from "${table}" ${predicate} order by ${columns} limit ${Math.min(137, size)}`,
          values,
        );
        const count = includeCount
          ? (await query(`select count(*)::int count from "${table}"`))[0].count
          : null;
        return { data, count };
      },
      async () => ({
        count: (await query(`select count(*)::int count from "${table}"`))[0]
          .count,
      }),
    );
  }
  const raw = {};
  await exec("set role service_role");
  await measure(
    "orders-keyset-read-10000",
    () => readTable("orders"),
    (rows) => assert.equal(rows.length, 10000),
    3,
  );
  for (const table of EXPORT_TABLES) raw[table] = await readTable(table);
  await exec("reset role"); // simulated Auth admin API source, not an application service_role grant
  const users = await collectExportUsers(async (page, size) => ({
    users: await query(
      "select id,email,created_at from auth.users order by id limit $1 offset $2",
      [size, (page - 1) * size],
    ),
    total: 1000,
  }));
  await measure(
    "users-group-and-derive-1000",
    async () => deriveUserRows(users, raw.entitlements, raw.orders, now),
    (rows) => {
      assert.equal(rows.length, 1000);
      assert(rows.every((row) => row.orderCount === 10));
    },
  );
  await measure(
    "dashboard-summarize-10000",
    async () =>
      summarizeDashboard({
        paidOrders: raw.orders,
        subscriptions: [],
        series: raw.series,
        articles: raw.articles,
        avatarUsageThisMonth: [],
        avatarUsageTotal: [],
        avatarCache: [],
        now,
      }),
    (result) => {
      assert.equal(result.revenueThisMonth, 100000);
      assert.equal(result.articlesPublished, 1000);
    },
  );
  let zipBytes = 0;
  let snapshot;
  await exec("set role service_role");
  await measure(
    "export-snapshot-query-and-validate",
    async () =>
      parseExportSnapshot(
        (await query("select public.export_site_snapshot(true,true) result"))[0]
          .result,
      ),
    (result) => {
      snapshot = result;
      assert.equal(result.rows.orders.length, 10000);
      assert.equal(result.rows.articles.length, 1000);
      assert.equal(result.users.length, 1000);
    },
    3,
  );
  await exec("reset role");
  await measure(
    "export-complete-archive",
    async () =>
      buildSiteExportArchive(snapshot.rows, snapshot.users, now, {
        mode: "single_statement_snapshot",
        captured_at: snapshot.capturedAt,
      }),
    (zip) => {
      zipBytes = zip.byteLength;
      const text = new TextDecoder().decode(zip);
      assert(text.includes('"orders": 10000'));
      assert(text.includes('"auth_users": 1000'));
      assert(text.includes("content/_standalone/scale-1000.md"));
      const eocd = new DataView(
        zip.buffer,
        zip.byteOffset + zip.byteLength - 22,
        22,
      );
      assert.equal(eocd.getUint32(0, true), 0x06054b50);
      // The table allowlist grows with the schema; each table must retain its own raw file.
      const expectedEntries =
        snapshot.rows.articles.length + EXPORT_TABLES.length + 7;
      assert.equal(eocd.getUint16(10, true), expectedEntries); // Markdown + raw tables + config/3 CSV + users/info/manifest
    },
    3,
  );
  const archiveCheck = inspectExportZip(
    buildSiteExportArchive(snapshot.rows, snapshot.users, now, {
      mode: "single_statement_snapshot",
      captured_at: snapshot.capturedAt,
    }),
  );
  assert.equal(archiveCheck.application_tables, EXPORT_TABLES.length);
  assert.equal(archiveCheck.auth_users, snapshot.users.length);
  assert.equal(archiveCheck.crc_and_file_hashes_valid, true);
  const report = {
    format: "wanyou.scale/1",
    completed_at: new Date().toISOString(),
    engine: embedded
      ? "PGlite (correctness only; not native performance)"
      : "PostgreSQL (native)",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model,
    logical_cpus: cpus().length,
    system_memory_bytes: totalmem(),
    database: (await query("select version() version"))[0].version,
    install_sha256: createHash("sha256").update(install).digest("hex"),
    verify_passed: checks.length,
    fixture: { ...counts, body_bytes_each: 8775 },
    measurements: metrics,
    query_plans: plans,
    adapter_page_cap: 137,
    pages,
    archive_bytes: zipBytes,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    limitations: [
      "warm cache; sequential, not a concurrent load test",
      "nine SQL/helper samples; three full-order-read/snapshot/archive samples",
      "simulated Auth schema; no Supabase Auth/PostgREST HTTP, network or Next SSR latency",
      "full export archive in memory; no Storage bytes",
      "legacy pagination remains non-atomic; production export uses one snapshot RPC",
    ],
  };
  if (reportPath)
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Scale acceptance\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
    );
  console.log(
    `SCALE PASS ${JSON.stringify({ engine: report.engine, fixture: report.fixture, archive_bytes: zipBytes, peak_rss_bytes: report.peak_rss_bytes, measurements: metrics })}`,
  );
} finally {
  try {
    if (db) {
      if (embedded) await db.close();
      else await db.end();
    }
    if (created) await admin.query(`drop database ${database}`);
  } finally {
    if (admin) await admin.end();
    clearInterval(heartbeat);
    clearTimeout(deadline);
  }
}
