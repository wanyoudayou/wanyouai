import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { zipSync, unzipSync } from "fflate";
import { packageRelease, validateSourceArchive } from "../scripts/release-package.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const bytes = text => Buffer.from(text);
function sourceFiles() {
  const manifest = { id: "wanyou-handbooks", name: "OPC手册管理器", version: "1.4.1", minAppVersion: "1.14.4" };
  const plugin = zipSync(Object.fromEntries(["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD_PARTY_LICENSES.txt"].map(name => [`wanyou-handbooks/${name}`, bytes(name === "manifest.json" ? JSON.stringify(manifest) : "fixture")])));
  const sql = bytes("-- isolated release fixture\n");
  return {
    "README.md": bytes("# Release fixture"), "LICENSE": bytes("MIT"), "THIRD_PARTY_NOTICES.md": bytes("Fixture notices"), ".env.example": bytes("SITE_URL=\n"),
    "package.json": bytes(JSON.stringify({ name: "release-fixture", version: "1.0.0", private: true, scripts: { "plugin:check": "node scripts/check-plugin.mjs" } })),
    "package-lock.json": bytes(JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } })),
    "supabase/install.sql": sql, "supabase/verify.sql": sql,
    "supabase/release-manifest.json": bytes(JSON.stringify({ schema_version: "20261026184628", artifacts: { "install.sql": hash(sql), "verify.sql": hash(sql) }, migrations: [] })),
    "content/starter/manifest.json": bytes("{}"), "src/generated/starter-content.json": bytes("{}"),
    "plugins/obsidian/manifest.json": bytes(JSON.stringify(manifest)),
    "releases/obsidian/wanyou-handbooks.zip": plugin,
    "releases/obsidian/wanyou-handbooks.zip.sha256": bytes(`${hash(plugin)}  wanyou-handbooks.zip\n`),
    ".gitignore": bytes("dist/\n"), ".gitattributes": bytes(".agents export-ignore\n"),
    ".agents/developer.md": bytes("Not a source-delivery dependency"),
    "scripts/check-plugin.mjs": bytes("import {mkdirSync,writeFileSync} from 'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/plugin-checked','yes');"),
  };
}
const archive = files => zipSync(Object.fromEntries(Object.entries(files).map(([name, data]) => [`wanyouai/${name}`, data])));

test("source releases reject real configuration, archive state, SQL drift and stale installers", () => {
  const valid = sourceFiles(); delete valid[".agents/developer.md"];
  assert.equal(validateSourceArchive(archive(valid)).version, "1.0.0");
  for (const name of [".env.local", "nested/.ENV.production", ".local-archive/evidence.json", ".aws/config", "debug.log", "private.key"]) {
    assert.throws(() => validateSourceArchive(archive({ ...valid, [name]: bytes("private fixture") })), /Forbidden release path/);
  }
  assert.throws(() => validateSourceArchive(archive({ ...valid, "supabase/install.sql": bytes("changed") })), /Database artifact drift/);
  const upgrade = { file: "upgrades/fixture.sql", sha256: hash(bytes("expected")) };
  const database = JSON.parse(valid["supabase/release-manifest.json"].toString());
  assert.throws(() => validateSourceArchive(archive({ ...valid,
    "supabase/release-manifest.json": bytes(JSON.stringify({ ...database, legacy_upgrade: upgrade })),
    "supabase/upgrades/fixture.sql": bytes("changed"),
  })), /Database upgrade drift/);
  assert.throws(() => validateSourceArchive(archive({ ...valid, "releases/obsidian/wanyou-handbooks.zip.sha256": bytes("0".repeat(64)) })), /checksum mismatch/);
  assert.throws(() => validateSourceArchive(archive({ ...valid, "package-lock.json": bytes('{"version":"0.1.0"}') })), /versions must match/);
});

test("packaging ships the committed source, verifies the plugin, is reproducible and never overwrites a different version", async () => {
  const root = await mkdtemp(join(tmpdir(), "wanyou-release-package-"));
  const git = args => execFileSync("git", args, { cwd: root, stdio: "pipe" }).toString().trim();
  try {
    for (const [name, data] of Object.entries(sourceFiles())) { await mkdir(join(root, name, ".."), { recursive: true }); await writeFile(join(root, name), data); }
    git(["init", "-q"]); git(["config", "user.email", "fixture@example.test"]); git(["config", "user.name", "Release fixture"]); git(["add", "."]); git(["-c", "commit.gpgsign=false", "commit", "-qm", "fixture"]);
    const result = await packageRelease(root);
    assert.equal(result.sourceCommit, git(["rev-parse", "HEAD"]));
    assert.equal(await readFile(join(root, "dist/plugin-checked"), "utf8"), "yes");
    const zipped = unzipSync(await readFile(join(result.directory, "wanyouai-v1.0.0.zip")));
    assert(!zipped["wanyouai/.agents/developer.md"]); assert(zipped["wanyouai/.env.example"]);
    const sums = await readFile(join(result.directory, "SHA256SUMS"), "utf8");
    for (const line of sums.trim().split("\n")) { const [expected, name] = line.split("  "); assert.equal(hash(await readFile(join(result.directory, name))), expected); }
    assert.deepEqual(await packageRelease(root), result);
    await writeFile(join(root, "README.md"), "dirty");
    await assert.rejects(packageRelease(root), /clean working tree/);
    git(["add", "."]); git(["-c", "commit.gpgsign=false", "commit", "-qm", "different commit, same version"]);
    await assert.rejects(packageRelease(root), /never overwrite a published version/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
