import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildZip } from "../src/lib/admin/export-zip";
import { inspectExportZip } from "../scripts/check-export-zip.mjs";

function archive(options: { wrongHash?: boolean; extraAuthField?: boolean; nonAtomic?: boolean } = {}) {
  const raw = [
    { path: "data/raw/site_config.json", content: JSON.stringify([{ id: 1 }]) },
    { path: "data/raw/app_schema_version.json", content: JSON.stringify([{ version: "20261008111841" }]) },
    { path: "data/auth-users.json", content: JSON.stringify([{
      id: "test-user", email: "user@example.com", ...(options.extraAuthField ? { encrypted_password: "trap" } : {}),
    }]) },
    { path: "EXPORT-INFO.txt", content: "test fixture" },
  ];
  const files = raw.map((entry) => ({
    path: entry.path,
    bytes: Buffer.byteLength(entry.content),
    sha256: createHash("sha256").update(entry.content).digest("hex"),
  }));
  if (options.wrongHash) files[0].sha256 = "0".repeat(64);
  const manifest = {
    format: "wanyou.export/1",
    schema_version: "20261008111841",
    consistency: options.nonAtomic ? { mode: "non_atomic" } :
      { mode: "single_statement_snapshot", captured_at: "2026-10-09T00:00:00Z" },
    row_counts: { site_config: 1, app_schema_version: 1 },
    auth_users: 1,
    files,
  };
  return buildZip([...raw, { path: "EXPORT-MANIFEST.json", content: JSON.stringify(manifest) }]);
}

test("download checker validates ZIP, file hashes, row counts and Auth allowlist", () => {
  const result = inspectExportZip(archive());
  assert.equal(result.zip_entries, 5);
  assert.equal(result.manifest_files, 4);
  assert.equal(result.application_rows, 2);
  assert.equal(result.auth_users, 1);
  assert.equal(result.crc_and_file_hashes_valid, true);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  assert(!JSON.stringify(result).includes("user@example.com"));
});

test("download checker rejects damaged bytes and manifest mismatch", () => {
  const damaged = archive().slice();
  const at = Buffer.from(damaged).indexOf("user@example.com");
  assert(at > 0);
  damaged[at] ^= 1;
  assert.throws(() => inspectExportZip(damaged), /CRC/);
  assert.throws(() => inspectExportZip(archive({ wrongHash: true })), /摘要/);
});

test("download checker rejects sensitive Auth fields and old non-atomic archives", () => {
  assert.throws(() => inspectExportZip(archive({ extraAuthField: true })), /Auth/);
  assert.throws(() => inspectExportZip(archive({ nonAtomic: true })), /快照模式/);
});
