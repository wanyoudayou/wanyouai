import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import { resolveTurnstilePublic, loadTurnstileRuntime } from "../src/lib/turnstile-config";
import { turnstileFromConfig } from "../src/lib/turnstile";

const OWNER = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const siteKey = "synthetic-site-key-a";
const secret = "synthetic-private-key-a";

test("turnstile: owner-only atomic save, conflict, pairing, disable and private credential boundaries", async t => {
  const db = new PGlite({ extensions: { vector } }); t.after(() => db.close());
  await installTestDatabase(db);
  const version = async () => (await db.query<{ value: string }>("select updated_at::text value from public.site_config where id=1")).rows[0].value;
  const call = (expected: string, enabled = true, key = siteKey, value = secret, clear = false) => db.query(
    "select public.save_turnstile_settings($1::timestamptz,$2,$3,$4,$5)", [expected, enabled, key, value, clear]);
  let expected = await version();
  await db.exec("set role anon");
  await assert.rejects(call(expected), /permission denied/);
  await assert.rejects(db.query("select value from public.site_secrets"), /permission denied/);
  await db.exec(`reset role;set role authenticated;set request.jwt.claims='{"sub":"${USER}"}'`);
  await assert.rejects(call(expected), /OWNER_REQUIRED/);
  await db.exec(`reset role;set role authenticated;set request.jwt.claims='{"sub":"${OWNER}"}'`);
  await assert.rejects(call(expected, true, siteKey, ""), /TURNSTILE_PAIR_REQUIRED/);
  assert.equal((await db.query<{ turnstile_config: unknown }>("select turnstile_config from public.site_config where id=1")).rows[0].turnstile_config, null);
  await call(expected);
  const publicRow = (await db.query<{ turnstile_config: unknown }>("select turnstile_config from public.site_config where id=1")).rows[0];
  assert.deepEqual(publicRow.turnstile_config, { enabled: true, site_key: siteKey });
  assert.ok(!JSON.stringify(publicRow).includes(secret));
  await assert.rejects(call(expected, false, siteKey, "replacement-private-key"), /SETTINGS_CONFLICT/);
  assert.equal((await db.query<{ value: string }>("select value from public.site_secrets where key='turnstile_secret_key'")).rows[0].value, secret);
  expected = await version();
  await assert.rejects(call(expected, true, "another-synthetic-site", ""), /TURNSTILE_NEW_PAIR_REQUIRED/);
  await call(expected, false, siteKey, "");
  expected = await version();
  await call(expected, true, siteKey, ""); // Same widget can reuse the saved credential.
  expected = await version();
  await assert.rejects(call(expected, true, siteKey, "", true), /TURNSTILE_PAIR_REQUIRED/);
  await call(expected, false, siteKey, "", true);
  assert.equal((await db.query("select value from public.site_secrets where key='turnstile_secret_key'")).rows.length, 0);
  await assert.rejects(db.query("update public.site_config set turnstile_config=$1::jsonb where id=1", [JSON.stringify({ enabled: false, site_key: "", secret })]), /site_config_turnstile_shape/);
  await db.exec(`reset role;set role authenticated;set request.jwt.claims='{"sub":"${USER}"}'`);
  assert.equal((await db.query("select value from public.site_secrets")).rows.length, 0);
  await db.exec("reset role;reset request.jwt.claims;set role anon");
  assert.ok(!JSON.stringify((await db.query("select turnstile_config from public.site_config")).rows).includes(secret));
});

test("turnstile: an explicit backend disable overrides legacy env; read failure never falls back", async () => {
  const env = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey, TURNSTILE_SECRET_KEY: secret };
  assert.equal(resolveTurnstilePublic(null, env).enabled, true);
  assert.equal(resolveTurnstilePublic({ enabled: false, site_key: siteKey }, env).enabled, false);
  assert.equal(resolveTurnstilePublic({}, env).enabled, false);
  const client = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ error: new Error(secret) }) }) }) }) };
  await assert.rejects(loadTurnstileRuntime(client as never, env), error => !String(error).includes(secret));
});

test("turnstile: fixed endpoint, host/action checks, invalid tokens and bounded response fail closed", async () => {
  let calls = 0;
  const verify = (data: unknown) => turnstileFromConfig({ enabled: true, secret }, "site.example", "avatar", async (url, init) => {
    calls++;
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.body as URLSearchParams).get("secret"), secret);
    return Response.json(data);
  })!;
  assert.equal(await verify({ success: true, hostname: "site.example", action: "avatar" }).verify("synthetic-token"), true);
  for (const data of [{ success: false }, { success: true, hostname: "wrong.example", action: "avatar" }, { success: true, hostname: "site.example", action: "inquiry" }]) {
    assert.equal(await verify(data).verify("synthetic-token"), false);
  }
  const before = calls;
  assert.equal(await verify({}).verify("x".repeat(2049)), false);
  assert.equal(calls, before);
  assert.equal(turnstileFromConfig({ enabled: false, secret }, "site.example", "avatar"), null);
  for (const response of [new Response("x".repeat(8193)), new Response("upstream-private-error", { status: 503 }), new Response("not-json")]) {
    assert.equal(await turnstileFromConfig({ enabled: true, secret }, "site.example", "avatar", async () => response)!.verify("synthetic-token"), false);
  }
  assert.equal(await turnstileFromConfig({ enabled: true, secret }, "site.example", "avatar", async () => { throw new Error(secret); })!.verify("synthetic-token"), false);
});
