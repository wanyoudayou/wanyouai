import { build } from "esbuild";
import { readFile, mkdir, writeFile, copyFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";

const out = "dist/plugins/wanyou-handbooks";
await mkdir(out, { recursive: true });
const result = await build({ entryPoints: ["plugins/obsidian/src/main.ts"], bundle: true, platform: "node", format: "cjs", target: "es2022", external: ["obsidian", "node:*"], outfile: `${out}/main.js`, metafile: true, sourcemap: false, minify: true });
for (const name of Object.keys(result.metafile.inputs)) {
  if (/(?:server-only|next[\/]|supabase|[\/]\.local-archive[\/]|src[\/]lib[\/](?:ai|skills|handbooks|supabase)[\/])/.test(name)) throw new Error(`Forbidden plugin dependency: ${name}`);
}
for (const file of ["manifest.json", "styles.css"]) await copyFile(`plugins/obsidian/${file}`, `${out}/${file}`);
// Include the full notices of packages actually bundled, rather than the whole dev tree.
const roots = new Set(); const notices = [];
for (const input of Object.keys(result.metafile.inputs).sort()) {
  if (!input.startsWith("node_modules/")) continue;
  let dir = dirname(resolve(input));
  for (;;) {
    const names = await readdir(dir);
    if (names.includes("package.json")) {
      if (!roots.has(dir)) {
        const info = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
        // A nested package.json may only declare module type; keep looking for its owner.
        if (!info.name) { dir = dirname(dir); continue; }
        roots.add(dir);
        const licenses = names.filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-]|$)/i.test(name)).sort();
        if (!licenses.length) throw new Error(`Missing bundled license: ${info.name}`);
        notices.push(`${info.name} ${info.version}\n${(await Promise.all(licenses.map(name => readFile(`${dir}/${name}`, "utf8")))).join("\n")}`);
      }
      break;
    }
    const parent = dirname(dir); if (parent === dir) throw new Error(`Package owner missing: ${input}`); dir = parent;
  }
}
await copyFile("LICENSE", `${out}/LICENSE`);
await writeFile(`${out}/THIRD_PARTY_LICENSES.txt`, notices.join("\n\n--------------------\n\n"));
const files = Object.fromEntries(await Promise.all(["main.js", "manifest.json", "styles.css", "LICENSE", "THIRD_PARTY_LICENSES.txt"].map(async f => [`wanyou-handbooks/${f}`, new Uint8Array(await readFile(`${out}/${f}`))])));
// Fixed archive metadata makes the committed installer reproducible across builds.
const zip = zipSync(files, { mtime: new Date(2000, 0, 1) });
const checksum = `${createHash("sha256").update(zip).digest("hex")}  wanyou-handbooks.zip\n`;
const path = "dist/plugins/wanyou-handbooks.zip";
await writeFile(path, zip); await writeFile(`${path}.sha256`, checksum);
const delivery = "releases/obsidian/wanyou-handbooks.zip";
if (process.argv.includes("--check")) {
  const [saved, savedChecksum] = await Promise.all([readFile(delivery), readFile(`${delivery}.sha256`, "utf8")]);
  if (!saved.equals(Buffer.from(zip)) || savedChecksum !== checksum) throw new Error("Obsidian installer is stale. Run npm run plugin:build and commit releases/obsidian/.");
  console.log(`Verified ${delivery}; checked ${Object.keys(result.metafile.inputs).length} module inputs.`);
} else {
  await mkdir(dirname(delivery), { recursive: true });
  await writeFile(delivery, zip); await writeFile(`${delivery}.sha256`, checksum);
  console.log(`Built ${delivery}; checked ${Object.keys(result.metafile.inputs).length} module inputs.`);
}
