// Export a committed tree without code sections, for publishing a public copy.
//   node scripts/export-public.mjs <target-dir> [--ref HEAD]
// <target-dir> is either missing/empty or a Git clone of the public repository; in a
// clone everything except .git is replaced, so the result can be reviewed and committed
// there. The source repository is never modified. Rules: docs/development/custom-sections.md
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|md|mdx|css|ya?ml|sql|txt|html|toml|sh)$/i;
const SKIP_DIRS = new Set([".git", "node_modules", ".next"]);

/** Section names (directories under src/sections not starting with "_") and the packages they own. */
export function listSections(root) {
  const dir = path.join(root, "src/sections");
  if (!existsSync(dir)) return { names: [], packages: [] };
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .map((entry) => entry.name)
    .sort();
  const packages = [];
  for (const name of names) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(dir, name, "manifest.json"), "utf8"));
      packages.push(...(Array.isArray(manifest.dependencies) ? manifest.dependencies : []));
    } catch {
      // A broken manifest still gets its directory removed; the leak scan covers the rest.
    }
  }
  return { names, packages: [...new Set(packages)].sort() };
}

/** Paths a section owns besides its directory and thin route (convention for browser tests). */
function ownedTests(root, name) {
  const dir = path.join(root, "tests/browser");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file === `${name}.spec.ts` || file.startsWith(`section-${name}.`) || file.startsWith(`section-${name}-`))
    .map((file) => path.join("tests/browser", file));
}

/** Remove every section from an exported tree. Returns the removed paths and dropped packages. */
export function stripSections(root) {
  const { names, packages } = listSections(root);
  const removed = [];
  const remove = (relative) => {
    const full = path.join(root, relative);
    if (existsSync(full)) {
      rmSync(full, { recursive: true, force: true });
      removed.push(relative);
    }
  };
  for (const name of names) {
    remove(`src/sections/${name}`);
    remove(`src/app/lab/${name}`);
    for (const file of ownedTests(root, name)) remove(file);
  }
  remove("src/generated/sections");
  const lab = path.join(root, "src/app/lab");
  if (existsSync(lab) && !readdirSync(lab).length) rmSync(lab, { recursive: true });

  if (packages.length) {
    const file = path.join(root, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    for (const name of packages) delete pkg.dependencies?.[name];
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return { names, packages, removed };
}

function walkText(root, directory = root, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkText(root, full, output);
    else if (TEXT_EXT.test(entry.name) || entry.name === "package-lock.json") output.push(full);
  }
  return output;
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** References to removed sections or their packages that would leak into the export. */
export function findLeaks(root, names, packages) {
  const patterns = [
    ...names.map((name) => ({
      label: `栏目 ${name}`,
      pattern: new RegExp(`(?:@/sections/|src/sections/|/lab/|generated/sections/)${escape(name)}(?![a-z0-9-])|"name"\\s*:\\s*"${escape(name)}"`),
    })),
    ...packages.map((name) => ({
      label: `依赖 ${name}`,
      pattern: new RegExp(`["'/]${escape(name)}["'/]`),
    })),
  ];
  const leaks = [];
  if (!patterns.length) return leaks;
  for (const file of walkText(root)) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    for (const { label, pattern } of patterns) {
      // package-lock is regenerated; a stale entry there is reported separately below.
      if (relative === "package-lock.json" && label.startsWith("依赖")) continue;
      if (relative.startsWith("src/sections/_sdk/") && label.startsWith("依赖")) continue;
      if (pattern.test(source)) leaks.push(`${relative}: ${label}`);
    }
  }
  return leaks;
}

function git(cwd, args, env) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function prepareTarget(target) {
  if (!existsSync(target)) return;
  if (!statSync(target).isDirectory()) throw new Error(`${target} 不是目录`);
  const entries = readdirSync(target);
  if (!entries.length) return;
  if (!entries.includes(".git")) throw new Error(`${target} 非空且不是 Git 仓库；请提供空目录或公开仓库的克隆`);
  if (git(target, ["status", "--porcelain"])) throw new Error(`${target} 有未提交的改动，请先处理`);
  for (const entry of entries) if (entry !== ".git") rmSync(path.join(target, entry), { recursive: true, force: true });
}

function main() {
  const args = process.argv.slice(2);
  const refIndex = args.indexOf("--ref");
  const ref = refIndex >= 0 ? args[refIndex + 1] : "HEAD";
  const target = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--ref");
  if (!target || !ref) {
    console.error("Usage: node scripts/export-public.mjs <target-dir> [--ref HEAD]");
    process.exit(1);
  }
  const source = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const out = path.resolve(target);
  if (out === source || out.startsWith(source + path.sep)) throw new Error("目标目录不能位于当前仓库内");
  const commit = git(source, ["rev-parse", "--verify", `${ref}^{commit}`]);
  prepareTarget(out);

  // Check out the committed tree through a throwaway index: the source index and
  // working tree stay untouched, and export-ignore attributes do not apply.
  const scratch = mkdtempSync(path.join(tmpdir(), "export-public-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(scratch, "index") };
    git(source, ["read-tree", commit], env);
    git(source, ["checkout-index", "--all", "--force", `--prefix=${out}${path.sep}`], env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  const { names, packages, removed } = stripSections(out);
  // The export has no node_modules yet; the source checkout's builder runs against it.
  execFileSync(process.execPath, [path.join(source, "scripts/build-sections.mjs"), "--root", out], { stdio: "inherit" });
  if (packages.length) {
    execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: out, stdio: "inherit" });
  }

  const leaks = findLeaks(out, names, packages);
  const lock = existsSync(path.join(out, "package-lock.json")) ? JSON.parse(readFileSync(path.join(out, "package-lock.json"), "utf8")) : null;
  for (const name of packages)
    if (lock?.packages?.[""]?.dependencies?.[name]) leaks.push(`package-lock.json: 依赖 ${name} 仍在根依赖中`);
  if (leaks.length) {
    for (const leak of leaks) console.error(`leak: ${leak}`);
    console.error(`Export incomplete: ${leaks.length} reference(s) to removed sections remain in ${out}. Fix them in the source and export again.`);
    process.exit(1);
  }
  console.log(`Exported ${commit.slice(0, 12)} to ${out}`);
  console.log(`Removed sections: ${names.length ? names.join(", ") : "none"}${packages.length ? `; packages: ${packages.join(", ")}` : ""}`);
  if (removed.length) for (const file of removed) console.log(`  - ${file}`);
  console.log("Next: npm ci && npm run contracts && npm run docs:check && npm run lint && npm run typecheck && npm run build in the export, then review and commit there.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
