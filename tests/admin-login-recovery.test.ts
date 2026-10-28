import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { adminCallbackUrl, validAdminEmail } from "../src/lib/admin/auth-flow";
import { ensureOwnerAfterLogin } from "../src/lib/admin/owner-bootstrap";
import { isPublicSupabaseKey } from "../src/lib/config/registry.mjs";
import { createElement, type ReactNode } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

class Redirect extends Error {
  constructor(readonly location: string) { super(location); }
}

async function load<T>(path: string, dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  runInNewContext(code, { ...globals, exports, require(name: string) {
    if (name in dependencies) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  } });
  return exports as T;
}

async function login({ otpFails = false, claimFails = false, outcome = "claimed" } = {}) {
  const calls: string[] = [];
  const user = { id: "verified-user", email: "owner@example.test", email_confirmed_at: "2026-10-20T00:00:00Z" };
  const client = { auth: {
    async verifyOtp() { calls.push(otpFails ? "invalid-otp" : "session-cookie-written"); return { error: otpFails ? new Error("expired") : null }; },
    async getUser() { return { data: { user }, error: null }; },
  } };
  const actions = await load<typeof import("../src/app/admin/actions")>("../src/app/admin/actions.ts", {
    "next/navigation": { redirect(location: string) { throw new Redirect(location); } },
    "next/cache": { revalidatePath() { calls.push("revalidate"); } },
    "@/lib/supabase/server": { async createSupabaseServerClient() { return client; } },
    "@/lib/admin/auth-flow": { adminCallbackUrl, validAdminEmail },
    "@/lib/admin/owner-bootstrap-server": { async bootstrapAdminOwner() {
      calls.push("claim");
      if (claimFails) throw new Error("permission denied");
      return outcome;
    } },
  });
  const form = new FormData();
  form.set("email", user.email); form.set("token", "123456");
  return { calls, run: () => actions.verifyAdminOtp({ message: "" }, form) };
}

test("verified OTP keeps a claim failure visible after the session cookie changes", async () => {
  const fixture = await login({ claimFails: true });
  await assert.rejects(fixture.run, (error: unknown) => error instanceof Redirect && error.location === "/admin?notice=owner-check-failed");
  assert.deepEqual(fixture.calls, ["session-cookie-written", "claim", "revalidate"]);
});

test("invalid OTP stays on the form and never attempts owner claim", async () => {
  const fixture = await login({ otpFails: true });
  assert.match((await fixture.run()).message, /验证码错误或已过期/);
  assert.deepEqual(fixture.calls, ["invalid-otp"]);
});

test("successful verification preserves the owner gate outcomes", async () => {
  for (const [outcome, location] of [
    ["claimed", "/admin"], ["owner", "/admin"],
    ["unconfigured", "/admin?notice=owner-unconfigured"],
    ["not_allowed", "/admin?notice=not-owner"],
    ["already_claimed", "/admin?notice=not-owner"],
  ]) {
    const fixture = await login({ outcome });
    await assert.rejects(fixture.run, (error: unknown) => error instanceof Redirect && error.location === location);
  }
});

test("public keys cannot create a privileged client; both supported server key formats can", async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_public-marker" };
  let created = 0;
  const service = await load<typeof import("../src/lib/supabase/service")>("../src/lib/supabase/service.ts", {
    "server-only": {},
    "@supabase/supabase-js": { createClient() { created++; return {}; } },
    "./request-options": { supabaseRequestOptions() { return {}; } },
    "@/lib/config/registry.mjs": { isPublicSupabaseKey },
  }, { process: { env } });
  assert.throws(() => service.createSupabaseServiceClient(), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "PUBLIC_SERVICE_KEY"));
  assert.equal(created, 0);
  for (const key of ["sb_secret_server-marker", `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`]) {
    env.SUPABASE_SERVICE_ROLE_KEY = key;
    service.createSupabaseServiceClient();
  }
  assert.equal(created, 2);
});

test("owner RPC failures log only their stage and safe error code", async () => {
  const logs: unknown[][] = [];
  const bootstrap = await load<typeof import("../src/lib/admin/owner-bootstrap-server")>("../src/lib/admin/owner-bootstrap-server.ts", {
    "server-only": {},
    "@/lib/supabase/service": { createSupabaseServiceClient() { return { rpc() { return Promise.resolve({ data: null, error: { code: "42501", message: "owner@example.test private-key-marker" } }); } }; } },
    "./owner-bootstrap": { ensureOwnerAfterLogin },
  }, { process: { env: { OWNER_EMAIL: "owner@example.test" } }, console: { error(...args: unknown[]) { logs.push(args); } } });
  const client = { rpc: async () => ({ data: false, error: null }) } as unknown as Parameters<typeof bootstrap.bootstrapAdminOwner>[0];
  await assert.rejects(() => bootstrap.bootstrapAdminOwner(client, { id: "verified-user", email: "owner@example.test", email_confirmed_at: "2026-10-20T00:00:00Z" } as Parameters<typeof bootstrap.bootstrapAdminOwner>[1]), /Owner bootstrap request failed/);
  assert.equal(JSON.stringify(logs), JSON.stringify([["owner_bootstrap_failed", { stage: "claim", code: "42501" }]]));
  assert.doesNotMatch(JSON.stringify(logs), /owner@example|private-key-marker/);
});

test("email-link callbacks distinguish verified identity from failed owner claim", async () => {
  const route = await load<typeof import("../src/app/auth/callback/route")>("../src/app/auth/callback/route.ts", {
    "next/server": { NextResponse: { redirect(url: URL, init: { status: number; headers: Record<string, string> }) { return new Response(null, { status: init.status, headers: { ...init.headers, Location: url.href } }); } } },
    "@/lib/supabase/server": { async createSupabaseServerClient() { return { auth: {
      async exchangeCodeForSession() { return { error: null }; },
      async getUser() { return { data: { user: { id: "verified-user", email_confirmed_at: "2026-10-20T00:00:00Z" } }, error: null }; },
    } }; } },
    "@/lib/admin/auth-flow": { adminCallbackUrl },
    "@/lib/admin/owner-bootstrap-server": { async bootstrapAdminOwner() { throw new Error("claim failed"); } },
  }, { process: { env: { SITE_URL: "https://site.example" } }, URL });
  const response = await route.GET(new Request("https://site.example/auth/callback?code=fixture-code"));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("Location"), "https://site.example/admin?notice=owner-check-failed");
  const invalid = await route.GET(new Request("https://site.example/auth/callback"));
  assert.equal(invalid.headers.get("Location"), "https://site.example/admin?notice=invalid-link");
});

test("the signed-in admin page renders the claim error outside the removed login form", async () => {
  const page = await load<typeof import("../src/app/admin/page")>("../src/app/admin/page.tsx", {
    "react/jsx-runtime": jsxRuntime,
    "@/lib/admin/list-query": {},
    "next/link": { default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) },
    "next/navigation": { redirect(location: string) { throw new Redirect(location); } },
    "@/lib/admin/session": { async getAdminIdentity() { return { user: { id: "verified-user", email: "owner@example.test" }, owner: false }; } },
    "@/components/admin/admin-login-form": { AdminLoginForm() { throw new Error("Authenticated users must not receive the login form"); } },
    "@/components/admin/admin-dashboard": { AdminDashboard() { throw new Error("Non-owners must not receive management content"); } },
    "@/components/ui/button": { Button: ({ children }: { children: ReactNode }) => createElement("button", null, children) },
    "./actions": { signOutAdmin() {} },
  });
  const html = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ notice: "owner-check-failed" }) }));
  assert.match(html, /邮箱已验证，但站主身份暂时无法验证/);
  assert.doesNotMatch(html, /当前邮箱不是本站指定站主|当前账户尚无站主权限/);
});
