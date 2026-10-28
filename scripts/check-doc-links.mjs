import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Check the maintained documentation tree; local archives are never inputs.
const root = fileURLToPath(new URL("../", import.meta.url));
const documents = [];
async function collect(directory, recursive = false) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) documents.push(name);
    else if (recursive && entry.isDirectory()) await collect(name, true);
  }
}
await collect("");
for (const directory of ["docs", "scripts", "tests", "supabase", "public", "content/starter", "releases"]) await collect(directory, true);
const failures = [];
let checked = 0;
for (const name of documents) {
  const markdown = (await readFile(path.join(root, name), "utf8")).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
  for (const match of markdown.matchAll(/!?\[[^\]\n]+\]\((<[^>]+>|[^)\s]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^[a-z][\w+.-]*:/i.test(target) || target.startsWith("#")) continue;
    if (name.startsWith("content/starter/") && target.startsWith("/") && !target.startsWith("//")) continue;
    const relative = decodeURIComponent(target.split("#")[0]);
    const resolved = path.resolve(root, path.dirname(name), relative);
    if (!resolved.startsWith(root) || resolved.includes(`${path.sep}.local-archive${path.sep}`)) {
      failures.push(`${name}: target outside maintained source: ${target}`); continue;
    }
    try { await access(resolved); checked++; }
    catch { failures.push(`${name}: missing ${target}`); }
  }
}
if (failures.length) throw new Error(`${failures.length} broken documentation links:\n${failures.join("\n")}`);
console.log(`Documentation links: ${checked} local paths across ${documents.length} documents passed.`);
