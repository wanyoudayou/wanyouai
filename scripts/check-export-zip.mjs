import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const fail = (reason) => { throw new Error(reason); };
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decoder = new TextDecoder("utf-8", { fatal: true });
const authFields = new Set([
  "id", "email", "phone", "created_at", "updated_at", "last_sign_in_at",
  "email_confirmed_at", "app_metadata", "user_metadata",
]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function readJson(bytes, label) {
  try { return JSON.parse(decoder.decode(bytes)); }
  catch { return fail(`${label} JSON 无效`); }
}

function readEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const within = (offset, size) => Number.isSafeInteger(offset) && offset >= 0 &&
    Number.isSafeInteger(size) && size >= 0 && offset + size <= bytes.byteLength;
  const u16 = (offset) => within(offset, 2) ? view.getUint16(offset, true) : fail("ZIP 截断");
  const u32 = (offset) => within(offset, 4) ? view.getUint32(offset, true) : fail("ZIP 截断");
  let end = -1;
  for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 22 - 65535); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.byteLength) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) !== 0 || u16(end + 6) !== 0 ||
      u16(end + 8) !== u16(end + 10)) fail("ZIP32 中央目录无效");
  const count = u16(end + 10);
  const centralSize = u32(end + 12);
  const centralStart = u32(end + 16);
  if (centralStart + centralSize !== end) fail("ZIP32 中央目录边界无效");
  const entries = new Map();
  let cursor = centralStart;
  for (let index = 0; index < count; index++) {
    if (!within(cursor, 46) || u32(cursor) !== 0x02014b50) fail("ZIP32 条目无效");
    const flags = u16(cursor + 8), method = u16(cursor + 10);
    const expectedCrc = u32(cursor + 16), packedSize = u32(cursor + 20), size = u32(cursor + 24);
    const nameSize = u16(cursor + 28), extraSize = u16(cursor + 30), commentSize = u16(cursor + 32);
    const localAt = u32(cursor + 42);
    if (flags !== 0x0800 || method !== 0 || size !== packedSize ||
        !within(cursor, 46 + nameSize + extraSize + commentSize)) fail("不支持的 ZIP 条目格式");
    let name;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize)); }
    catch { fail("ZIP 文件名不是 UTF-8"); }
    if (!name || name.startsWith("/") || name.includes("\\") ||
        name.split("/").some((part) => !part || part === "." || part === "..") ||
        entries.has(name)) fail("ZIP 文件名不安全或重复");
    if (!within(localAt, 30) || u32(localAt) !== 0x04034b50 ||
        u16(localAt + 6) !== flags || u16(localAt + 8) !== method ||
        u32(localAt + 14) !== expectedCrc || u32(localAt + 18) !== size ||
        u32(localAt + 22) !== size) fail("ZIP 本地条目与目录不一致");
    const localNameSize = u16(localAt + 26), localExtraSize = u16(localAt + 28);
    const dataAt = localAt + 30 + localNameSize + localExtraSize;
    if (!within(localAt, 30 + localNameSize + localExtraSize) || !within(dataAt, size) ||
        decoder.decode(bytes.subarray(localAt + 30, localAt + 30 + localNameSize)) !== name ||
        dataAt + size > centralStart) fail("ZIP 本地条目边界无效");
    const content = bytes.subarray(dataAt, dataAt + size);
    if (crc32(content) !== expectedCrc) fail("ZIP CRC 校验失败");
    entries.set(name, content);
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end || entries.size !== count) fail("ZIP 中央目录计数无效");
  return entries;
}

/** Verify bytes and manifest without printing article, user or site data. */
export function inspectExportZip(bytes) {
  if (!(bytes instanceof Uint8Array)) fail("导出文件类型无效");
  const entries = readEntries(bytes);
  const manifestBytes = entries.get("EXPORT-MANIFEST.json");
  if (!manifestBytes) fail("缺少导出清单");
  const manifest = readJson(manifestBytes, "导出清单");
  if (manifest?.format !== "wanyou.export/1" ||
      manifest?.consistency?.mode !== "single_statement_snapshot" ||
      !Number.isFinite(Date.parse(manifest.consistency.captured_at)) ||
      !Array.isArray(manifest.files) ||
      !manifest.row_counts || typeof manifest.row_counts !== "object" ||
      Array.isArray(manifest.row_counts) ||
      !Number.isSafeInteger(manifest.auth_users) || manifest.auth_users < 0) fail("导出清单结构或快照模式无效");
  if (manifest.files.length !== entries.size - 1) fail("导出清单文件数不符");
  const listed = new Set();
  for (const item of manifest.files) {
    if (typeof item?.path !== "string" || item.path === "EXPORT-MANIFEST.json" ||
        listed.has(item.path) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
        typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(item.sha256)) fail("导出清单文件项无效");
    const content = entries.get(item.path);
    if (!content || content.byteLength !== item.bytes || hash(content) !== item.sha256) fail("导出文件大小或摘要不符");
    listed.add(item.path);
  }
  if ([...entries.keys()].some((path) => path.includes("site_secrets") ||
      (path !== "EXPORT-MANIFEST.json" && !listed.has(path)))) fail("ZIP 含清单外或敏感文件");
  const tables = Object.entries(manifest.row_counts);
  if (!tables.length || manifest.row_counts.site_config !== 1 || manifest.row_counts.app_schema_version !== 1) fail("应用表清单无效");
  let rows = 0;
  for (const [table, count] of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !Number.isSafeInteger(count) || count < 0) fail("应用表行数无效");
    const content = entries.get(`data/raw/${table}.json`);
    if (!content) fail("缺少应用表文件");
    const tableRows = readJson(content, "应用表");
    if (!Array.isArray(tableRows) || tableRows.length !== count) fail("应用表行数与清单不符");
    rows += count;
  }
  const usersBytes = entries.get("data/auth-users.json");
  if (!usersBytes) fail("缺少 Auth 用户文件");
  const users = readJson(usersBytes, "Auth 用户");
  if (!Array.isArray(users) || users.length !== manifest.auth_users || users.some((user) =>
    !user || typeof user !== "object" || Array.isArray(user) ||
    Object.keys(user).some((key) => !authFields.has(key)))) fail("Auth 用户数量或字段越界");
  return {
    format: manifest.format,
    bytes: bytes.byteLength,
    sha256: hash(bytes),
    zip_entries: entries.size,
    manifest_files: manifest.files.length,
    schema_version: manifest.schema_version,
    consistency: manifest.consistency,
    application_tables: tables.length,
    application_rows: rows,
    auth_users: users.length,
    crc_and_file_hashes_valid: true,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error("用法：node scripts/check-export-zip.mjs /path/to/wanyou-export.zip");
    process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(inspectExportZip(await readFile(process.argv[2])), null, 2)); }
    catch (error) {
      console.error(`导出校验失败：${error instanceof Error ? error.message : "未知错误"}`);
      process.exitCode = 1;
    }
  }
}
