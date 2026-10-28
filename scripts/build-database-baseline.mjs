import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readApplicationCatalog, renderApplicationCatalog, canonicalCatalog } from "./database-catalog.mjs";
import { renderInstall, renderDemo, renderVerify } from "./database-install-artifacts.mjs";

const directory = new URL("../supabase/", import.meta.url);
const platform = `create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,aud text,role text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz not null default now());
  create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
  grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to public;`;
const legacy = new PGlite({ extensions: { vector } });
const baseline = new PGlite({ extensions: { vector } });
const reconstructed = new PGlite({ extensions: { vector } });
try {
  await legacy.exec(platform);
  const order = JSON.parse(await readFile(new URL("legacy-install-order.json", directory), "utf8"));
  for (const file of order.filter((file) => file !== "legacy/seed.sql")) await legacy.exec(await readFile(new URL(file, directory), "utf8"));
  const oldCatalog = await readApplicationCatalog(legacy);
  await legacy.exec(await readFile(new URL("legacy/seed.sql", directory), "utf8"));
  const snapshot = async () => {
    const result = [];
    for (const { name, columns } of oldCatalog.tables) {
      const projection = columns.map(({ name }) => '"' + name.replaceAll('"', '""') + '"').join(',');
      result.push((await legacy.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from (select ${projection} from public."${name}") t`)).rows[0].rows);
    }
    return createHash("sha256").update(JSON.stringify(result)).digest("hex");
  };
  await legacy.exec("insert into public.avatar_usage(model,tokens_in,tokens_out) values('upgrade-preservation-probe',7,3)");
  const before = await snapshot();
  await legacy.exec(await readFile(new URL("upgrades/complete-v1-to-release-baseline.sql", directory), "utf8"));
  assert.equal(await snapshot(), before, "Legacy upgrade changed existing application data");
  const migrationFiles = (await readdir(new URL("migrations/", directory))).filter((file) => file.endsWith(".sql"));
  assert.ok(migrationFiles.every((file) => /^\d{14}_[\w-]+\.sql$/.test(file)), "Migration filename must come from Supabase migration new");
  const files = migrationFiles.sort();
  assert.ok(files.length, "No versioned migrations found");
  const migrations = await Promise.all(files.map(async (file) => ({ file, sql: await readFile(new URL(`migrations/${file}`, directory), "utf8") })));
  // The one-time legacy upgrade reaches the first baseline. Future changes have one
  // maintenance source: append the same subsequent migrations on both paths.
  assert.equal(files[0], "20260928124423_release_baseline.sql", "Legacy adoption target changed; review its upgrade path");
  for (const migration of migrations.slice(1)) await legacy.exec(migration.sql);
  assert.equal(await snapshot(), before, "Subsequent release migrations changed historical application rows");
  const catalog = await readApplicationCatalog(legacy);
  await reconstructed.exec(platform);
  await reconstructed.exec(renderApplicationCatalog(catalog));
  assert.deepEqual(canonicalCatalog(await readApplicationCatalog(reconstructed)), canonicalCatalog(catalog), "Final-state reconstruction omitted application objects or permissions");
  const version = files.at(-1).slice(0, 14);
  const source = migrations.map(({ file, sql }) => `-- Source migration: ${file}\n${sql.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}`).join("\n");
  const install = renderInstall(source, "");
  const demo = renderDemo(await readFile(new URL("legacy/seed.sql", directory), "utf8"));
  const verify = renderVerify(catalog, version);
  // Apply both payment changes atomically: never expose the intermediate schema
  // with a new reference column but an unguarded legacy settlement entrypoint.
  const paymentFiles = ["20261011115340_payment_external_reference.sql", "20261011144257_enforce_payment_reference_at_settlement.sql"];
  const paymentSource = paymentFiles.map(file => {
    const migration = migrations.find(m => m.file === file);
    assert.ok(migration, `Missing payment migration ${file}`);
    return `-- Source migration: ${file}\n${migration.sql.replace(/^begin;\s*$/gm, "").replace(/^commit;\s*$/gm, "")}`;
  }).join("\n");
  const paymentUpgradeFile = "upgrades/20261010053221-to-payment-reference.sql";
  const paymentUpgrade = `-- GENERATED by npm run db:baseline. Review/backup and reconcile legacy pending orders first.
-- For application version 20261010053221 only. Keeps both payment migrations atomic.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $pause$ begin
  if exists(select 1 from public.site_config where commerce->>'payment_enabled'='true') then
    raise exception 'PAYMENT_UPGRADE_REQUIRES_PAYMENTS_PAUSED';
  end if;
end $pause$;
${paymentSource}
commit;
`;
  await baseline.exec(platform);
  // New hosted projects can already have a Dashboard-managed automatic-RLS trigger.
  await baseline.exec(`create function public.rls_auto_enable() returns event_trigger language plpgsql security definer set search_path=pg_catalog as $$ begin return; end $$;
    create event trigger platform_rls_probe on ddl_command_end execute function public.rls_auto_enable();
    create extension vector with schema public;`);
  // Simulate permissive platform default grants; the baseline must reset them.
  await baseline.exec("alter default privileges in schema public grant all on tables to anon, authenticated; alter default privileges in schema public grant all on sequences to anon, authenticated;");
  // A partially occupied project must fail before adding any application objects.
  await baseline.exec("create table public.install_probe(id integer)");
  await assert.rejects(baseline.exec(install), /Existing objects detected/);
  await baseline.exec("rollback; drop table public.install_probe");
  assert.equal((await baseline.query("select to_regclass('public.site_config') present")).rows[0].present, null);
  await baseline.exec(install);
  assert.equal((await baseline.query("select has_function_privilege('anon','public.rls_auto_enable()','EXECUTE') allowed")).rows[0].allowed, false);
  assert.deepEqual(canonicalCatalog(await readApplicationCatalog(baseline)), canonicalCatalog(catalog), "Generated baseline differs from the final legacy SQL state");
  await baseline.exec("begin; create table public.future_acl_probe(id integer)");
  for (const role of ["anon", "authenticated", "service_role"]) {
    for (const privilege of ["SELECT", "TRUNCATE"]) {
      assert.equal((await baseline.query("select has_table_privilege($1,'public.future_acl_probe',$2) allowed", [role, privilege])).rows[0].allowed, false,
        `New tables must not inherit ${privilege} for ${role}`);
    }
  }
  await baseline.exec("rollback");
  await assert.rejects(baseline.exec(install), /Existing objects detected/);
  await baseline.exec("rollback");
  const site = (await baseline.query("select identity, constraints, home_config, contact, commerce, avatar_config from public.site_config where id=1")).rows[0];
  const ajv = new Ajv2020({ strict: false, allErrors: true }); addFormats(ajv);
  const validate = ajv.compile(JSON.parse(await readFile(new URL("../docs/contracts/site-config.schema.json", directory), "utf8")));
  assert.equal(validate(site), true, JSON.stringify(validate.errors));
  assert.equal(site.commerce.subscription_price, null);
  assert.equal(site.commerce.payment_enabled, false);
  assert.equal(site.avatar_config.enabled, false);
  const verifyResult = await baseline.query(verify);
  assert.deepEqual(verifyResult.rows.filter((row) => !row.passed), [], "Installation verification failed");
  await baseline.exec("grant truncate on public.articles to anon");
  assert.equal((await baseline.query(verify)).rows.find((row) => row.check_name === "api_table_maintenance_denied").passed, false);
  await baseline.exec("revoke truncate on public.articles from anon");
  await baseline.exec("alter table public.article_bodies disable row level security");
  assert.equal((await baseline.query(verify)).rows.find((row) => row.check_name === "application_rls_enabled").passed, false);
  await baseline.exec("alter table public.article_bodies enable row level security");
  // Exercise identity sequences, triggers, RLS and the payment transaction after reconstruction.
  await baseline.exec(demo);
  assert.deepEqual((await baseline.query("select identity, constraints, home_config, contact, commerce, avatar_config from public.site_config where id=1")).rows[0], site, "Demo changed site configuration");
  await assert.rejects(baseline.exec(demo), /unused instance/);
  await baseline.exec("rollback");
  await baseline.exec(await readFile(new URL("tests/rls-fixtures.sql", directory), "utf8"));
  await baseline.exec("reset role; set role service_role");
  const orderId = (await baseline.query("insert into public.orders(user_id,sku_type,amount) values('00000000-0000-4000-8000-000000000002','subscription',199) returning id")).rows[0].id;
  await baseline.query("update public.orders set created_at=now()-interval '11 minutes' where id=$1", [orderId]);
  const claim = async () => (await baseline.query("select id from public.claim_pending_payment_reconciliation()")).rows.map(row => row.id);
  assert.deepEqual(await claim(), [orderId], "Eligible pending order must be claimed");
  assert.deepEqual(await claim(), [], "Recently claimed order must not be claimed again");
  await baseline.query("update public.orders set reconcile_checked_at=now()-interval '31 minutes' where id=$1", [orderId]);
  assert.deepEqual(await claim(), [orderId], "Expired check interval must allow another claim");
  const settle = async () => (await baseline.query("select public.settle_payment_reference((select merchant_order_no from public.orders where id=$1),'baseline-probe',199,(select jsonb_build_object('out_trade_no',merchant_order_no,'source','reconcile') from public.orders where id=$1)) result", [orderId])).rows[0].result;
  assert.equal(await settle(), "settled");
  assert.equal(await settle(), "duplicate");
  assert.deepEqual(await claim(), [], "Paid order must no longer be reconciled");
  assert.equal((await baseline.query("select count(*)::int count from public.entitlements where user_id='00000000-0000-4000-8000-000000000002' and type='subscription'")).rows[0].count, 1);
  assert.equal((await baseline.query("select count(*)::int count from public.payment_events where event_id='baseline-probe'")).rows[0].count, 1);
  assert.equal((await baseline.query("select count(*)::int count from public.email_outbox where order_id=$1", [orderId])).rows[0].count, 1);
  await baseline.exec("reset role; reset request.jwt.claims; set role anon");
  assert.equal((await baseline.query("select has_function_privilege('anon','public.claim_pending_payment_reconciliation()','EXECUTE') allowed")).rows[0].allowed, false);
  assert.equal((await baseline.query("select count(*)::int count from public.article_bodies b join public.articles a on a.id=b.article_id where a.access<>'public' and not exists(select 1 from public.series s where s.readme_article_id=a.id)")).rows[0].count, 0);
  assert.equal((await baseline.query("select has_table_privilege('authenticated','public.bookings','UPDATE') allowed")).rows[0].allowed, false);
  // authenticated INSERT exists for owner check-in; ordinary users must still fail RLS.
  await baseline.exec("reset role; set role authenticated; set request.jwt.claims='{\"sub\":\"00000000-0000-4000-8000-000000000002\"}'");
  await assert.rejects(baseline.exec("insert into public.entitlements(user_id,type,source) values('00000000-0000-4000-8000-000000000002','subscription','order')"), /row-level security/);
  const sql = renderApplicationCatalog(catalog);
  const upgradeSource = await readFile(new URL("upgrades/complete-v1-to-release-baseline.sql", directory), "utf8");
  const manifest = JSON.stringify({ legacy_upgrade: { file: "upgrades/complete-v1-to-release-baseline.sql", sha256: createHash("sha256").update(upgradeSource).digest("hex") }, payment_upgrade: { file: paymentUpgradeFile, sha256: createHash("sha256").update(paymentUpgrade).digest("hex") }, format: "wanyou.database/1", schema_version: version, migrations: migrations.map(({ file, sql }) => ({ file, sha256: createHash("sha256").update(sql).digest("hex") })), artifacts: Object.fromEntries(Object.entries({ "baseline.sql": sql, "install.sql": install, "demo.sql": demo, "verify.sql": verify }).map(([file, content]) => [file, createHash("sha256").update(content).digest("hex")])) }, null, 2) + "\n";
  for (const [file, content] of Object.entries({ "baseline.sql": sql, "install.sql": install, "demo.sql": demo, "verify.sql": verify, [paymentUpgradeFile]: paymentUpgrade, "release-manifest.json": manifest })) {
    const target = new URL(file, directory);
    if (process.argv.includes("--check")) assert.equal(await readFile(target, "utf8"), content, `${file} is stale; run npm run db:baseline`);
    else await writeFile(target, content);
  }
  console.log(`Install candidate verified: ${catalog.tables.length} tables, ${catalog.functions.length} functions, ${catalog.policies.length} policies. Fresh-only guards, neutral config, optional demo, read-only checks, RLS and payment replay passed. No data exported.`);
} catch (error) {
  console.error(`Database baseline failed: ${String(error.message).slice(0, 1500)}`);
  process.exitCode = 1;
} finally {
  await Promise.all([legacy.close(), baseline.close(), reconstructed.close()]);
}
