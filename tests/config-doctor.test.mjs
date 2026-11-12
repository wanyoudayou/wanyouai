import test from "node:test";
import assert from "node:assert/strict";
import { inspectConfig } from "../scripts/config-registry.mjs";

const base = {
  SITE_URL: "https://site.example",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret-marker",
  PUBLISH_TOKEN: "x".repeat(32),
  OWNER_EMAIL: "owner@example.test",
};

test("doctor checks required and optional config without exposing values", () => {
  const ready = inspectConfig(base);
  assert.ok(ready.every((check) => ["ready", "disabled"].includes(check.status)));
  assert.equal(JSON.stringify(ready).includes("service-secret-marker"), false);
  const missing = inspectConfig({ ...base, OWNER_EMAIL: "", ZPAY_PID: "merchant" });
  assert.equal(missing.find((check) => check.id === "OWNER_EMAIL")?.status, "error");
  assert.equal(missing.find((check) => check.id === "payment")?.status, "incomplete");
  assert.equal(inspectConfig({ ...base, SITE_URL: "http://site.example" }).find((check) => check.id === "SITE_URL")?.status, "error");
  assert.equal(inspectConfig({ ...base, OWNER_EMAIL: "" }, { existingSite: true }).find((check) => check.id === "OWNER_EMAIL")?.status, "skipped");
});

test("doctor rejects public Supabase keys in the server management variable", () => {
  const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
  for (const key of ["sb_publishable_public-marker", jwt("anon"), jwt("authenticated")]) {
    const checks = inspectConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: key });
    assert.equal(checks.find((check) => check.id === "SUPABASE_SERVICE_ROLE_KEY")?.status, "error");
    assert.equal(JSON.stringify(checks).includes(key), false);
  }
  for (const key of ["sb_secret_server-marker", jwt("service_role")]) {
    assert.equal(inspectConfig({ ...base, SUPABASE_SERVICE_ROLE_KEY: key }).find((check) => check.id === "SUPABASE_SERVICE_ROLE_KEY")?.status, "ready");
  }
});
