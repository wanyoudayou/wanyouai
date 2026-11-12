import test from "node:test";
import assert from "node:assert/strict";
import { adminCallbackUrl, validAdminEmail } from "../src/lib/admin/auth-flow";

test('callback only uses configured canonical origin', () => {
  assert.equal(adminCallbackUrl('https://site.example/unused?next=https://evil.example'), 'https://site.example/auth/callback');
  assert.equal(adminCallbackUrl('http://localhost:3104'), 'http://localhost:3104/auth/callback');
  for (const value of [undefined, 'javascript:alert(1)', 'http://public.example', 'https://secret@site.example']) assert.throws(() => adminCallbackUrl(value));
});
test('login rejects invalid emails before calling auth', () => {
  assert.equal(validAdminEmail('owner@example.test'), true);
  for (const value of [null, '', 'no-at-sign', 'a@b', 'a b@example.test', 'x'.repeat(255) + '@example.test']) assert.equal(validAdminEmail(value), false);
});

test('login return path stays on this site and outside auth/admin areas', async () => {
  const { safeReturnPath, loginHref } = await import("../src/lib/account/auth-flow");
  assert.equal(safeReturnPath("/handbooks/guide?article=intro#top"), "/handbooks/guide?article=intro#top");
  assert.equal(safeReturnPath("/events/meetup"), "/events/meetup");
  for (const bad of [undefined, "", "https://evil.example/x", "//evil.example", "/\\evil.example", "/\nx", "javascript:alert(1)", "/login", "/login?next=/x", "/admin", "/admin/setup", "/api/orders", "/auth/callback", `/${"a".repeat(600)}`])
    assert.equal(safeReturnPath(bad), "/me", String(bad));
  assert.equal(loginHref("/checkout/12"), "/login?next=%2Fcheckout%2F12");
});
