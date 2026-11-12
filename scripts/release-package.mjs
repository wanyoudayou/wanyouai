import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = bytes => JSON.parse(Buffer.from(bytes).toString("utf8"));
const semver = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const required = ["README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", ".env.example", "package.json", "package-lock.json", "supabase/install.sql", "supabase/verify.sql", "supabase/release-manifest.json", "content/starter/manifest.json", "src/generated/starter-content.json", "releases/obsidian/wanyou-handbooks.zip", "releases/obsidian/wanyou-handbooks.zip.sha256", "plugins/obsidian/manifest.json"];

export function validateSourceArchive(bytes) {
  const archive = unzipSync(bytes);
  const files = new Map();
  for (const [path, content] of Object.entries(archive)) {
    if (!path.startsWith("wanyouai/") || path.split("/").includes("..")) throw new Error("Invalid source archive root");
    if (path.endsWith("/")) continue;
    const name = path.slice("wanyouai/".length);
    const parts = name.split("/"); const base = parts.at(-1);
    if (parts.some(part => [".git", ".local-archive", ".vercel", ".next", "node_modules", ".agents", ".codex", ".aws", ".ssh", ".gnupg", "test-results", "playwright-report", "dist", ".ds_store", ".netrc", ".git-credentials"].includes(part.toLowerCase())) ||
        (base.toLowerCase().startsWith(".env") && name !== ".env.example") || /\.(?:log|pem|key|p12|tgz|tsbuildinfo)$/i.test(base))
      throw new Error(`Forbidden release path: ${name}`);
    files.set(name, content);
  }
  for (const name of required) if (!files.has(name)) throw new Error(`Release file missing: ${name}`);
  const pkg = json(files.get("package.json")); const lock = json(files.get("package-lock.json"));
  if (!semver.test(pkg.version) || lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version)
    throw new Error("Application and lockfile versions must match");
  const database = json(files.get("supabase/release-manifest.json"));
  for (const [name, hash] of Object.entries(database.artifacts ?? {}))
    if (!files.has(`supabase/${name}`) || digest(files.get(`supabase/${name}`)) !== hash) throw new Error(`Database artifact drift: ${name}`);
  for (const migration of database.migrations ?? [])
    if (!files.has(`supabase/migrations/${migration.file}`) || digest(files.get(`supabase/migrations/${migration.file}`)) !== migration.sha256) throw new Error(`Migration drift: ${migration.file}`);
  for (const upgrade of [database.legacy_upgrade, database.payment_upgrade].filter(Boolean))
    if (!files.has(`supabase/${upgrade.file}`) || digest(files.get(`supabase/${upgrade.file}`)) !== upgrade.sha256) throw new Error(`Database upgrade drift: ${upgrade.file}`);
  if (!/^\d{14}$/.test(database.schema_version) || !database.artifacts?.["install.sql"] || !database.artifacts?.["verify.sql"])
    throw new Error("Database release manifest is incomplete");
  const pluginBytes = files.get("releases/obsidian/wanyou-handbooks.zip");
  const savedHash = Buffer.from(files.get("releases/obsidian/wanyou-handbooks.zip.sha256")).toString("utf8").trim().split(/\s+/)[0];
  if (digest(pluginBytes) !== savedHash) throw new Error("Obsidian installer checksum mismatch");
  const plugin = unzipSync(pluginBytes);
  const expectedPluginFiles = ["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD_PARTY_LICENSES.txt"].map(name => `wanyou-handbooks/${name}`).sort();
  if (JSON.stringify(Object.keys(plugin).filter(name => !name.endsWith("/")).sort()) !== JSON.stringify(expectedPluginFiles)) throw new Error("Unexpected Obsidian installer contents");
  const pluginManifest = json(plugin["wanyou-handbooks/manifest.json"]);
  const pluginSource = json(files.get("plugins/obsidian/manifest.json"));
  if (JSON.stringify(pluginManifest) !== JSON.stringify(pluginSource) || !semver.test(pluginManifest.version) || pluginManifest.id !== "wanyou-handbooks") throw new Error("Obsidian installer manifest is stale");
  return { version: pkg.version, databaseSchema: database.schema_version, pluginManifest, pluginBytes, fileCount: files.size };
}

export async function packageRelease(root = fileURLToPath(new URL("../", import.meta.url))) {
  const git = args => execFileSync("git", args, { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  if (git(["status", "--porcelain", "--untracked-files=all"]).toString().trim()) throw new Error("Release packaging requires a clean working tree");
  const sourceCommit = git(["rev-parse", "HEAD"]).toString().trim();
  for (const entry of git(["ls-tree", "-rz", "HEAD"]).toString().split("\0").filter(Boolean))
    if (/^(?:120000|160000) /.test(entry)) throw new Error("Source release cannot contain symlinks or submodules");
  try { execFileSync("npm", ["run", "plugin:check"], { cwd: root, stdio: "pipe" }); }
  catch { throw new Error("Obsidian source verification failed; run npm run plugin:check for diagnostics"); }
  if (git(["status", "--porcelain", "--untracked-files=all"]).toString().trim()) throw new Error("Plugin verification changed tracked source");
  const source = git(["archive", "--format=zip", "--prefix=wanyouai/", "HEAD"]);
  const checked = validateSourceArchive(source);
  const sourceName = `wanyouai-v${checked.version}.zip`;
  const outputs = new Map([[sourceName, source], ["wanyou-handbooks.zip", checked.pluginBytes]]);
  const manifest = { format: "wanyou.release/1", version: checked.version, source_commit: sourceCommit, database_schema: checked.databaseSchema,
    plugin: { id: checked.pluginManifest.id, version: checked.pluginManifest.version, minimum_obsidian: checked.pluginManifest.minAppVersion },
    files: Object.fromEntries([...outputs].map(([name, bytes]) => [name, digest(bytes)])) };
  outputs.set("release-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  outputs.set("SHA256SUMS", Buffer.from([...outputs].map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join("")));
  const parent = join(root, "dist/releases"); await mkdir(parent, { recursive: true });
  const destination = join(parent, `v${checked.version}`);
  let existing;
  try { existing = await readdir(destination); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing) {
    if (JSON.stringify(existing.sort()) !== JSON.stringify([...outputs.keys()].sort())) throw new Error("Existing release directory contains different files");
    for (const [name, bytes] of outputs) if (!Buffer.from(bytes).equals(await readFile(join(destination, name)))) throw new Error("Existing release differs; never overwrite a published version");
  } else {
    const staging = await mkdtemp(join(parent, ".package-"));
    try {
      for (const [name, bytes] of outputs) await writeFile(join(staging, name), bytes);
      await rename(staging, destination);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  return { directory: destination, sourceCommit, version: checked.version, sourceFiles: checked.fileCount, hashes: manifest.files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await packageRelease(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Release packaging failed"); process.exitCode = 1; }
}
