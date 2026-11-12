import test from "node:test";
import assert from "node:assert/strict";
import { assertNoCredentialTokens } from "../scripts/check-environment-template.mjs";

test("environment instructions can name bare prefixes without embedding keys", () => {
  assert.doesNotThrow(() => assertNoCredentialTokens("# 公钥 sb_publishable_，服务端 sb_secret_，邮件 re_\nKEY=your-key\n"));
});

test("populated credential-like tokens are rejected in values and comments without being printed", () => {
  for (const prefix of ["sb_secret_", "sb_publishable_", "re_"]) {
    const key = `${prefix}synthetic-test-marker`;
    for (const text of [`KEY=${key}\n`, `# example: ${key}\n`]) {
      assert.throws(() => assertNoCredentialTokens(text), (error) => error instanceof Error && !error.message.includes(key));
    }
  }
});
