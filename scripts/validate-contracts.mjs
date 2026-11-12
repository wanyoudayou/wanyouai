import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import Ajv2020 from "ajv/dist/2020.js";
import { assertNoCredentialTokens } from "./check-environment-template.mjs";

const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });
const jsonFiles = [
  "docs/card.schema.json",
  "docs/contracts/publish-frontmatter.schema.json",
  "docs/contracts/site-config.schema.json",
];

for (const file of jsonFiles) {
  const schema = JSON.parse(await readFile(file, "utf8"));
  const validator = ajv.compile(schema);
  for (const [index, example] of (schema.examples ?? []).entries()) {
    if (!validator(example)) {
      console.error(validator.errors);
      throw new Error(`${file} example ${index + 1} is invalid`);
    }
  }
  if (schema.examples?.length) console.log(`${file} examples ok: ${schema.examples.length}`);
  console.log(`schema ok: ${file}`);
}

const policies = await readFile("supabase/legacy/policies.sql", "utf8");
if (policies.includes("create table")) throw new Error("policies.sql must not create tables");
if (policies.includes("alter table site_secrets")) {
  throw new Error("policies.sql must not enable RLS on site_secrets");
}
console.log("SQL contract invariants ok");

const installOrder = JSON.parse(await readFile("supabase/install-order.json", "utf8"));
for (const [file, title] of [
  ["README.md", "数据库初始化"],
  ["docs/deployment/guide.md", "按序执行 SQL"],
]) {
  const lines = (await readFile(file, "utf8")).split("\n");
  const start = lines.findIndex((line) => /^#{2,3} /.test(line) && line.includes(title));
  if (start < 0) throw new Error(`${file} install section missing`);
  const level = lines[start].match(/^#+/)[0].length;
  const nextHeading = new RegExp(`^#{1,${level}}\\s`);
  const end = lines.findIndex((line, index) => index > start && nextHeading.test(line));
  const section = lines.slice(start + 1, end < 0 ? undefined : end);
  const documented = section.filter((line) => /^supabase\/[\w-]+\.sql$/.test(line)).map((line) => line.slice("supabase/".length));
  assert.deepEqual(documented, installOrder, `${file} SQL order differs from install-order.json`);
}
console.log(`installation SQL order ok: ${installOrder.length} files`);

const release = JSON.parse(await readFile("supabase/release-manifest.json", "utf8"));
const upgradeRows = (await readFile("docs/operations/database-upgrade.md", "utf8")).split("\n").filter(line => /^\| `\d{14}` \|/.test(line));
const versions = release.migrations.map(migration => migration.file.slice(0, 14));
let cursor = 0;
for (const row of upgradeRows) {
  const cells = row.split("|").slice(1, -1).map(cell => cell.trim());
  assert.equal(cells.length, 3, `Upgrade table must have three columns: ${row}`);
  const from = cells[0].replaceAll("`", "");
  const to = cells[2].replaceAll("`", "");
  assert.equal(from, versions[cursor], `Upgrade chain is out of order at ${from}`);
  const file = /\]\(\.\.\/\.\.\/supabase\/([^)]+)\)/.exec(cells[1])?.[1];
  const next = versions.indexOf(to);
  if (file === release.payment_upgrade.file) {
    assert.equal(next, cursor + 2, "Payment combination must cover exactly its two migrations");
    assert(file.includes(from), "Payment combination starts at the wrong version");
  } else {
    assert.equal(next, cursor + 1, `Upgrade table skips a migration at ${from}`);
    assert.equal(file, `migrations/${release.migrations[next]?.file}`, `Upgrade file differs at ${from}`);
  }
  cursor = next;
}
assert.equal(versions[cursor], release.schema_version, "Upgrade table does not reach the release version");
console.log(`database upgrade chain ok: ${upgradeRows.length} steps`);

const envExample = await readFile(".env.example", "utf8");
assertNoCredentialTokens(envExample);
console.log("environment template ok");
