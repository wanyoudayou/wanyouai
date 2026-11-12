import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { inspectSkillPackage } from "../src/lib/skills/package";
import { packagePath, credentialFile } from "../src/lib/skills/package-policy";

const instructions = "---\nname: text-helper\ndescription: Help edit text.\n---\nRead references/style.md before editing.";
const zip = (files: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(files).map(([p, v]) => [p, typeof v === "string" ? strToU8(v) : v])));
test("script attachments are downloadable data, not readable model tools", async () => {
  const result = await inspectSkillPackage(zip({ "SKILL.md": instructions, "scripts/main.py": "raise Exception('never execute')", "references/style.md": "中文风格" }));
  assert.equal(result.onlineEligible, true);
  assert.equal(result.texts.get("references/style.md"), "中文风格");
  assert.equal(result.texts.has("scripts/main.py"), false);
  assert.equal(result.manifest.length, 3);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});
test("single named folder is accepted without exposing its storage path", async () => {
  const result = await inspectSkillPackage(zip({ "text-helper/SKILL.md": instructions, "text-helper/.env.example": "API_KEY=" }));
  assert.equal(result.manifest[0].path, ".env.example");
  await assert.rejects(inspectSkillPackage(zip({ "wrong/SKILL.md": instructions })), /文件夹名称/);
});
test("reject traversal, platform aliases, credentials and file/directory collisions", async () => {
  for (const p of ["../x", "/x", "C:/x", "x\\y", "a//b", "a/../b", "con.txt", "x ", "x?key=y"]) assert.throws(() => packagePath(p));
  for (const p of [".env", "x/.env.local", ".ssh/id_rsa", ".aws/credentials", "certs/private.P12", "signing.pfx", "app.jks", "release.keystore"]) assert.equal(credentialFile(p), true);
  const fixtures: Record<string, string>[] = [{ "a": "x", "a/b": "y" }, { "A.txt": "x", "a.txt": "y" }, { ".env.local": "KEY=x" }, { "key.txt": "-----BEGIN PRIVATE KEY-----" }];
  for (const files of fixtures) {
    await assert.rejects(inspectSkillPackage(zip({ "SKILL.md": instructions, ...files })));
  }
  await assert.rejects(inspectSkillPackage(zip({ "SKILL.md": instructions, "certs/signing.p12": new Uint8Array([48, 130, 0, 3]) })), /凭据文件/);
});
test("reject oversized expansion and invalid YAML, keep large instructions download-only", async () => {
  await assert.rejects(inspectSkillPackage(zip({ "SKILL.md": instructions, "bomb.txt": new Uint8Array(10 * 1024 * 1024 + 1) })), /限制/);
  await assert.rejects(inspectSkillPackage(zip({ "SKILL.md": "---\nname: x\nname: y\ndescription: test\n---\nbody" })), /格式/);
  await assert.rejects(inspectSkillPackage(zip({ "SKILL.md": "---\nname: text-helper\ndescription: &a [*a]\n---\nbody" })));
  const result = await inspectSkillPackage(zip({ "SKILL.md": instructions + "\nx".repeat(20000) }));
  assert.equal(result.onlineEligible, false);
  assert.equal(result.texts.has("SKILL.md"), false);
});

test("reject forged CRC, symlink and encrypted archive entries", async () => {
  const original = zip({ "SKILL.md": instructions });
  const central = Buffer.from(original).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  assert.ok(central > 0);
  const crc = Buffer.from(original); crc.writeUInt32LE(0, central + 16);
  await assert.rejects(inspectSkillPackage(crc), /校验码/);
  const symlink = Buffer.from(original); symlink.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
  await assert.rejects(inspectSkillPackage(symlink), /链接/);
  const encrypted = Buffer.from(original); encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
  await assert.rejects(inspectSkillPackage(encrypted), /加密/);
});
