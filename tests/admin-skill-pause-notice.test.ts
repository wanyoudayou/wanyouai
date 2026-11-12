import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";

test("old and new Skill pause entrypoints share notice identity and deduplicate entitlement holders", async () => {
  const sent: object[] = []; const notices: Record<string, unknown>[] = [];
  const service = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "fixture@example.test" } } }) } },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const data = () => table === "articles" || table === "series" ? { title: "Skill", type: "skill" }
        : table === "skills" ? { id: 10, legacy_series_id: 20 }
        : table === "site_config" ? { site_name: "Fixture" }
        : table === "email_sends" ? notices.find(n => n.ref_id === filters.ref_id) ?? null
        : [{ user_id: "same-buyer", starts_at: "2000-01-01", ends_at: null }];
      const q = { select: () => q, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, is: () => q, limit: () => q,
        maybeSingle: async () => ({ data: data(), error: null }), then: (yes: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(yes),
        insert: async (row: Record<string, unknown>) => { notices.push(row); return { error: null }; } };
      return q;
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "@/lib/supabase/service": { createSupabaseServiceClient: () => service },
    "@/lib/mailer": { escapeHtml: (s: string) => s, renderMailHtml: () => "fixture", mailerFromEnv: () => ({ send: async (row: object) => { sent.push(row); } }) },
  };
  const exports = {} as typeof import("../src/lib/admin/pause-notice");
  const source = await readFile(new URL("../src/lib/admin/pause-notice.ts", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, process: { env: { SITE_URL: "https://fixture.invalid" } }, require: (name: string) => { assert(name in dependencies); return dependencies[name]; } });
  assert.equal((await exports.sendPauseNotice("article", 10)).notified, 1);
  assert.equal((await exports.sendPauseNotice("series", 20)).alreadySent, true);
  assert.equal(sent.length, 1); assert.equal(notices.length, 1);
  assert.match(String(notices[0].ref_id), /^series:20:/);
});
