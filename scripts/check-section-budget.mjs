// After `npm run build`: each code section's first-load client JS increment
// (chunks its client modules need that the home page does not already load)
// must stay within manifest budgetKb (gzip). Lazy `import()` chunks are excluded.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const next = path.join(root, ".next");
const { sections } = JSON.parse(readFileSync(path.join(root, "src/generated/sections.json"), "utf8"));

if (!sections.length) {
  console.log("Section budgets ok: no sections registered.");
  process.exit(0);
}
if (!existsSync(path.join(next, "BUILD_ID"))) {
  console.error("No production build found. Run npm run build first.");
  process.exit(1);
}

function manifest(route) {
  const file = path.join(next, "server/app", route, "page_client-reference-manifest.js");
  if (!existsSync(file)) return null;
  const scope = { __RSC_MANIFEST: {} };
  new Function("globalThis", readFileSync(file, "utf8"))(scope);
  return Object.values(scope.__RSC_MANIFEST)[0] ?? null;
}

function chunks(entries) {
  const files = new Set();
  for (const entry of entries)
    if (!entry.async) for (const chunk of entry.chunks ?? []) if (chunk.endsWith(".js")) files.add(chunk);
  return files;
}

const home = manifest("");
const shared = home ? chunks(Object.values(home.clientModules)) : new Set();
let failed = false;
for (const section of sections) {
  const routeDir = `lab/${section.name}/[[...rest]]`;
  const routeManifest = manifest(routeDir);
  if (!routeManifest) {
    console.error(`${section.name}: build output for /${routeDir} not found.`);
    failed = true;
    continue;
  }
  const sourceDir = path.join(root, "src/sections", section.name) + path.sep;
  const own = chunks(
    Object.entries(routeManifest.clientModules)
      .filter(([module]) => module.startsWith(sourceDir))
      .map(([, entry]) => entry),
  );
  const pageChunks = existsSync(path.join(next, "static/chunks/app", routeDir))
    ? readdirSync(path.join(next, "static/chunks/app", routeDir)).filter((file) => file.endsWith(".js")).map((file) => `static/chunks/app/${routeDir}/${file}`)
    : [];
  for (const file of pageChunks) own.add(file);
  let bytes = 0;
  for (const file of own) {
    if (shared.has(file)) continue;
    const target = path.join(next, file);
    if (existsSync(target)) bytes += gzipSync(readFileSync(target)).length;
  }
  const kb = bytes / 1024;
  const line = `${section.name}: ${kb.toFixed(1)} KB gzip (budget ${section.budgetKb} KB)`;
  if (kb > section.budgetKb) {
    console.error(`${line} — over budget. Lazy-load heavy parts with next/dynamic or import().`);
    failed = true;
  } else console.log(line);
}
process.exit(failed ? 1 : 0);
