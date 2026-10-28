import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeploymentChecks } from "../src/components/admin/deployment-checks";
import { inspectDeployment, type DeploymentGateway, type DeploymentReport } from "../src/lib/admin/deployment-checks";

const version = "20260928124423";
const marker = "sensitive-fixture-value";
const env = {
  SITE_URL: "https://site.example", NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-fixture", SUPABASE_SERVICE_ROLE_KEY: marker,
  PUBLISH_TOKEN: marker.repeat(2), ZPAY_BASE_URL: "https://pay.example", ZPAY_PID: marker, ZPAY_KEY: marker,
  RESEND_API_KEY: marker, EMAIL_FROM: `Site <${marker}@example.test>`, CRON_SECRET: marker,
};
const gateway = (overrides: Partial<DeploymentGateway> = {}): DeploymentGateway => ({
  isOwner: async () => true,
  env: () => env,
  schemaVersion: async () => version,
  site: async () => ({ identityReady: true, paymentEnabled: true, paymentChannelsReady: true, avatarEnabled: true, avatarModelReady: true }),
  mediaReady: async () => true,
  aiStatus: async () => ({ generation: "ready", embedding: "ready", knowledge: "ready", avatar: "ready" }),
  hasPublishedContent: async () => true,
  mailQueue: async () => ({ dead: 0, oldest_due_seconds: 0 }),
  ...overrides,
});
const status = (report: DeploymentReport, id: string) => report.sections.flatMap((section) => section.checks).find((check) => check.id === id)?.status;

test("deployment: dead letters and overdue mail show an actionable owner-only failure", async () => {
  for (const health of [{ dead: 1, oldest_due_seconds: 0 }, { dead: 0, oldest_due_seconds: 601 }]) {
    assert.equal(status(await inspectDeployment(gateway({ mailQueue: async () => health }), version), "mail_queue"), "incomplete");
  }
  const fail = async () => { throw new Error(marker); };
  const report = await inspectDeployment(gateway({ mailQueue: fail }), version);
  assert.equal(status(report, "mail_queue"), "error");
  assert.equal(JSON.stringify(report).includes(marker), false);
});

test("deployment: unauthenticated and registered non-owner requests cannot read config or create authority probes", async () => {
  for (const identity of ["anonymous", "registered"]) {
    const fail = () => { throw new Error(`${identity}: forbidden probe`); };
    await assert.rejects(inspectDeployment(gateway({ isOwner: async () => false, env: fail, schemaVersion: fail, site: fail, mediaReady: fail, aiStatus: fail, hasPublishedContent: fail, mailQueue: fail }), version), /需要站主身份/);
  }
});

test("deployment: full automatic success leaves all real-world acceptance checks unverified and exposes no values in SSR", async () => {
  const report = await inspectDeployment(gateway(), version);
  assert.equal(status(report, "schema"), "ready");
  assert.equal(status(report, "payment_runtime"), "ready");
  assert.equal(status(report, "avatar_runtime"), "ready");
  assert.equal(status(report, "OWNER_EMAIL"), "skipped");
  assert.ok(report.sections.at(-1)?.checks.every((check) => check.status === "unverified"));
  assert.equal(JSON.stringify(report).includes(marker), false);
  const html = renderToStaticMarkup(createElement(DeploymentChecks, { report }));
  assert.equal(html.includes(marker), false);
  assert.ok(html.includes("待人工验收"));
  assert.ok(html.includes("/admin/card"));
});

test("deployment: outages produce partial failures without default-config success or raw network errors", async () => {
  const fail = async () => { throw new Error(`https://project.example?token=${marker}`); };
  const report = await inspectDeployment(gateway({ site: fail, mediaReady: fail, aiStatus: fail }), version);
  for (const id of ["site_config", "identity", "media", "payment_runtime", "avatar_runtime"]) assert.equal(status(report, id), "error");
  assert.equal(status(report, "schema"), "ready");
  assert.equal(status(report, "publication"), "ready");
  assert.equal(JSON.stringify(report).includes(marker), false);
});

test("deployment: optional disabled features need no model credential probe", async () => {
  const report = await inspectDeployment(gateway({
    env: () => ({ ...env, ZPAY_BASE_URL: "", ZPAY_PID: "", ZPAY_KEY: "", RESEND_API_KEY: "", EMAIL_FROM: "" }),
    site: async () => ({ identityReady: false, paymentEnabled: false, paymentChannelsReady: false, avatarEnabled: false, avatarModelReady: false }),
    aiStatus: async () => ({ generation: "disabled", embedding: "disabled", knowledge: "disabled", avatar: "disabled" }),
    hasPublishedContent: async () => false,
  }), version);
  for (const id of ["payment", "transactional_email", "payment_runtime", "avatar_runtime", "cron"]) assert.equal(status(report, id), "disabled");
  for (const id of ["identity", "publication"]) assert.equal(status(report, id), "incomplete");
});

test("deployment: newer database, partial payment group, invalid endpoint and missing cron cannot be green", async () => {
  const report = await inspectDeployment(gateway({ schemaVersion: async () => "20990101000000", env: () => ({ ...env, ZPAY_KEY: "", CRON_SECRET: "" }) }), version);
  assert.equal(status(report, "cron"), "unverified");
  for (const id of ["schema", "payment", "payment_runtime"]) assert.equal(status(report, id), "incomplete");
  assert.equal(status(await inspectDeployment(gateway({ aiStatus: async () => ({ generation: "incomplete", embedding: "ready", knowledge: "ready", avatar: "incomplete" }) }), version), "avatar_runtime"), "incomplete");
  assert.equal(status(await inspectDeployment(gateway({ aiStatus: async () => ({ generation: "ready", embedding: "incomplete", knowledge: "incomplete", avatar: "incomplete" }) }), version), "avatar_runtime"), "incomplete");
});

test("deployment: backend Turnstile status is authoritative and failed reads are not green", async () => {
  for (const state of ["ready", "disabled"] as const) {
    const report = await inspectDeployment(gateway({ turnstileStatus: async () => state }), version);
    assert.equal(status(report, "turnstile"), state);
  }
  const report = await inspectDeployment(gateway({ turnstileStatus: async () => { throw new Error(marker); } }), version);
  assert.equal(status(report, "turnstile"), "error");
  assert.ok(!JSON.stringify(report).includes(marker));
});

test("deployment: business groups retain every check once and never auto-approve manual acceptance", async () => {
  const report = await inspectDeployment(gateway(), version);
  const all = report.sections.flatMap((section) => section.checks);
  assert.equal(new Set(all.map((check) => check.id)).size, all.length);
  const sectionFor = (id: string) => report.sections.find((section) => section.checks.some((check) => check.id === id))?.title;
  for (const id of ["auth", "transactional_email", "mail_queue", "mail_acceptance"]) assert.equal(sectionFor(id), "邮件：登录与业务通知");
  for (const id of ["payment", "payment_runtime", "payment_acceptance"]) assert.equal(sectionFor(id), "可选：支付收款");
  for (const id of ["turnstile", "embedding", "avatar_runtime", "avatar_acceptance"]) assert.equal(sectionFor(id), "可选：AI 分身与匿名人机验证");
  assert.equal(sectionFor("cron"), "可选：自动任务");
  for (const check of all.filter((check) => check.steps)) {
    assert.equal(check.status, "unverified");
    assert.ok(check.steps!.length >= 2);
  }
  const html = renderToStaticMarkup(createElement(DeploymentChecks, { report }));
  assert.match(html, /<details[^>]*><summary/);
  assert.match(html, /如何验收/);
  assert.match(html, /<ol[^>]*>/);
  assert.equal(html.includes(marker), false);
});

test("deployment: SMTP-only, partial and malformed app mail config are distinct without exposing values", async () => {
  const mail = async (values: Record<string, string>) => {
    const report = await inspectDeployment(gateway({ env: () => ({ ...env, ...values }) }), version);
    assert.equal(JSON.stringify(report).includes(marker), false);
    return report.sections.flatMap((section) => section.checks).find((check) => check.id === "transactional_email")!;
  };
  const smtpOnly = await mail({ RESEND_API_KEY: "", EMAIL_FROM: "" });
  assert.equal(smtpOnly.status, "disabled");
  assert.match(smtpOnly.hint, /登录验证码由 Supabase SMTP/);
  for (const missing of ["RESEND_API_KEY", "EMAIL_FROM"]) {
    const partial = await mail({ [missing]: "" });
    assert.equal(partial.status, "incomplete");
    assert.ok(partial.hint.startsWith(`缺少：${missing}。`));
  }
  const malformed = await mail({ EMAIL_FROM: marker });
  assert.equal(malformed.status, "incomplete");
  assert.match(malformed.hint, /^EMAIL_FROM 格式检查未通过/);
});

test("deployment: disabled optional acceptance hides steps but mail backlog and required login remain visible", async () => {
  const report = await inspectDeployment(gateway({
    env: () => ({ ...env, RESEND_API_KEY: "", EMAIL_FROM: "", ZPAY_BASE_URL: "", ZPAY_PID: "", ZPAY_KEY: "" }),
    site: async () => ({ identityReady: true, paymentEnabled: false, paymentChannelsReady: false, avatarEnabled: false, avatarModelReady: false }),
    aiStatus: async () => ({ generation: "disabled", embedding: "disabled", knowledge: "disabled", avatar: "disabled" }),
    mailQueue: async () => ({ dead: 1, oldest_due_seconds: 0 }),
  }), version);
  for (const id of ["mail_acceptance", "payment_acceptance", "avatar_acceptance"]) {
    assert.equal(status(report, id), "disabled");
    const check = report.sections.flatMap((section) => section.checks).find((check) => check.id === id)!;
    const html = renderToStaticMarkup(createElement(DeploymentChecks, { report: { sections: [{ title: "Test", checks: [check] }] } }));
    assert.equal(html.includes("<details"), false);
    assert.match(html, /未启用/);
  }
  assert.equal(status(report, "auth"), "unverified");
  assert.equal(status(report, "mail_queue"), "incomplete");
});

test("deployment: payment-only installation still needs task auth, and failed site reads do not hide acceptance", async () => {
  const report = await inspectDeployment(gateway({ env: () => ({ ...env, RESEND_API_KEY: "", EMAIL_FROM: "", CRON_SECRET: "" }) }), version);
  assert.equal(status(report, "cron"), "unverified");
  const failed = await inspectDeployment(gateway({ site: async () => { throw new Error(marker); } }), version);
  for (const id of ["payment_acceptance", "avatar_acceptance"]) assert.equal(status(failed, id), "error");
  assert.equal(JSON.stringify(failed).includes(marker), false);
});
