import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { installTestDatabase } from "./support/database";
import {
  parseExportSnapshot,
  readExportSnapshot,
} from "../src/lib/admin/export-snapshot";
import { buildSiteExportArchive } from "../src/lib/admin/export-archive";
import { EXPORT_TABLES } from "../src/lib/admin/export-pagination";

function emptySnapshot() {
  return {
    format: "wanyou.snapshot/1",
    captured_at: "2026-10-08T12:00:00Z",
    rows: Object.fromEntries(
      EXPORT_TABLES.map((table) => [
        table,
        table === "site_config"
          ? [{ id: 1 }]
          : table === "app_schema_version"
            ? [{ id: 1, version: "fixture" }]
            : [],
      ]),
    ),
    users: [] as Record<string, unknown>[],
  };
}

test("export snapshot: service-only RPC returns complete allowlisted data and no credentials", async (t) => {
  const db = new PGlite({ extensions: { vector } });
  t.after(() => db.close());
  await installTestDatabase(db, { fixtures: false });
  await db.exec(`alter table auth.users add column encrypted_password text, add column recovery_token text;
    insert into auth.users(id,email,encrypted_password,recovery_token) values
      ('00000000-0000-4000-8000-000000000001','snapshot@example.test','PASSWORD_TRAP','RECOVERY_TRAP');
    update profiles set is_owner=true;
    insert into site_secrets(key,value) values('snapshot_secret','SITE_SECRET_TRAP');`);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(
      `reset role; set role ${role}; set request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001"}'`,
    );
    await assert.rejects(
      db.query("select public.export_site_snapshot(true,true)"),
      /permission denied/,
    );
  }
  await db.exec("reset role; set role service_role");
  const raw = (
    await db.query<{ result: unknown }>(
      "select public.export_site_snapshot(true,true) result",
    )
  ).rows[0].result;
  const snapshot = parseExportSnapshot(raw);
  const legacy = (
    await db.query<{ result: { rows: Record<string, unknown> } }>(
      "select public.export_site_snapshot() result",
    )
  ).rows[0].result;
  assert.equal(
    "media_assets" in legacy.rows,
    false,
    "legacy app export remains compatible during rollout/rollback",
  );
  assert.deepEqual(
    Object.keys(snapshot.rows).sort(),
    [...EXPORT_TABLES].sort(),
  );
  assert.equal(snapshot.users[0].email, "snapshot@example.test");
  assert.equal(
    snapshot.rows.articles.length,
    (await db.query("select id from articles")).rows.length,
  );
  assert(!JSON.stringify(raw).includes("TRAP"));
  const zip = buildSiteExportArchive(
    snapshot.rows,
    snapshot.users,
    new Date(snapshot.capturedAt),
    { mode: "single_statement_snapshot", captured_at: snapshot.capturedAt },
  );
  // Read every stored ZIP entry and verify manifest hashes, not only the end marker.
  const bytes = Buffer.from(zip);
  const files = new Map<string, Buffer>();
  for (let offset = 0; bytes.readUInt32LE(offset) === 0x04034b50; ) {
    const size = bytes.readUInt32LE(offset + 18),
      nameSize = bytes.readUInt16LE(offset + 26),
      extra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + nameSize + extra;
    files.set(
      bytes.toString("utf8", offset + 30, offset + 30 + nameSize),
      bytes.subarray(start, start + size),
    );
    offset = start + size;
  }
  const manifest = JSON.parse(files.get("EXPORT-MANIFEST.json")!.toString());
  assert.equal(manifest.consistency.mode, "single_statement_snapshot");
  assert.equal(manifest.consistency.captured_at, snapshot.capturedAt);
  assert.equal(manifest.files.length, files.size - 1);
  for (const file of manifest.files) {
    assert.equal(files.get(file.path)!.byteLength, file.bytes);
    assert.equal(
      createHash("sha256").update(files.get(file.path)!).digest("hex"),
      file.sha256,
    );
  }
});

test("export snapshot: incomplete tables, widened Auth fields and unsafe IDs are rejected", () => {
  assert.equal(parseExportSnapshot(emptySnapshot()).users.length, 0);
  const missing = emptySnapshot();
  delete missing.rows.orders;
  assert.throws(() => parseExportSnapshot(missing), /结构不完整/);
  const broadened = emptySnapshot();
  broadened.rows.site_secrets = [];
  assert.throws(() => parseExportSnapshot(broadened), /结构不完整/);
  const credentials = emptySnapshot();
  credentials.users.push({ id: "u", encrypted_password: "not-exportable" });
  assert.throws(() => parseExportSnapshot(credentials), /结构不完整/);
  const unsafe = emptySnapshot();
  unsafe.rows.orders = [{ id: Number.MAX_SAFE_INTEGER + 1 }];
  assert.throws(() => parseExportSnapshot(unsafe), /结构不完整/);
  const duplicate = emptySnapshot();
  duplicate.rows.orders = [{ id: 1 }, { id: 1 }];
  assert.throws(() => parseExportSnapshot(duplicate), /结构不完整/);
});

test("export snapshot: one SDK RPC and no silent pagination fallback on missing migration", async () => {
  let calls = 0,
    fail = false;
  const client = createClient("https://example.supabase.co", "test-key", {
    db: { retry: false },
    auth: { persistSession: false },
    global: {
      fetch: async (input, init) => {
        calls++;
        assert.equal(
          new URL(String(input)).pathname,
          "/rest/v1/rpc/export_site_snapshot",
        );
        assert.equal(init?.method, "POST");
        return fail
          ? Response.json(
              { code: "PGRST202", message: "missing function" },
              { status: 404 },
            )
          : Response.json(emptySnapshot());
      },
    },
  });
  await readExportSnapshot(client);
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(readExportSnapshot(client), /数据库升级/);
  assert.equal(calls, 2);
});
