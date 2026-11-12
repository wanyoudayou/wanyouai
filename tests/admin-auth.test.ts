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
