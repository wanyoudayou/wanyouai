import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import { parseDocument } from "yaml";
import { credentialFile, packagePath, SKILL_LIMITS, SkillPackageError, textReference, type SkillFile } from "./package-policy";

export type InspectedSkillPackage = {
  name: string; description: string; sha256: string; byteSize: number;
  manifest: SkillFile[]; texts: Map<string, string>; onlineEligible: boolean;
};
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** No filesystem extraction, recursive archives, executable loaders or URL fetching. */
export async function inspectSkillPackage(input: Uint8Array): Promise<InspectedSkillPackage> {
  if (!input.length || input.length > SKILL_LIMITS.archiveBytes) throw new SkillPackageError("ZIP 不能超过 20 MiB。");
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const raw = new Map<string, { bytes: Buffer; sha256: string }>();
  await new Promise<void>((resolve, reject) => {
    let archive: ZipFile | undefined; let settled = false; let total = 0; let entries = 0;
    const names = new Map<string, boolean>();
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); archive?.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new SkillPackageError("文件包校验超时，请缩小文件包。")), 20000);
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) { finish(new SkillPackageError("ZIP 格式无效。")); return; }
      archive = zip;
      zip.on("error", () => finish(new SkillPackageError("ZIP 数据损坏或尺寸不符。")));
      zip.on("end", () => finish());
      zip.on("entry", (entry: Entry) => {
        void (async () => {
          if (settled) return;
          if (++entries > 1000 || entry.isEncrypted()) throw new SkillPackageError("不支持加密包或过多目录。");
          const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (mode !== 0 && mode !== 0o100000 && mode !== 0o040000) throw new SkillPackageError("文件包不能包含链接或设备文件。");
          const directory = entry.fileName.endsWith("/");
          if ((mode === 0o040000 && !directory) || (mode === 0o100000 && directory)) throw new SkillPackageError("文件与目录类型不一致。");
          const path = packagePath(directory ? entry.fileName.slice(0, -1) : entry.fileName);
          const key = path.toLowerCase();
          if (names.has(key)) throw new SkillPackageError("文件包包含重名或大小写冲突的路径。");
          const parents = key.split("/"); parents.pop();
          while (parents.length) {
            if (names.get(parents.join("/")) === false) throw new SkillPackageError("文件与目录路径冲突。");
            parents.pop();
          }
          if (!directory && [...names.keys()].some(n => n.startsWith(key + "/"))) throw new SkillPackageError("文件与目录路径冲突。");
          names.set(key, directory);
          if (credentialFile(path)) throw new SkillPackageError(`请移除凭据文件：${path}`);
          if (directory) { zip.readEntry(); return; }
          if (raw.size >= SKILL_LIMITS.files || entry.uncompressedSize > SKILL_LIMITS.fileBytes || total + entry.uncompressedSize > SKILL_LIMITS.expandedBytes)
            throw new SkillPackageError("文件包超过文件数量或解压大小限制。");
          const stream = await new Promise<import("node:stream").Readable>((yes, no) => zip.openReadStream(entry, (e, s) => e || !s ? no(e ?? new Error()) : yes(s)));
          const chunks: Buffer[] = []; let size = 0;
          try {
            for await (const chunk of stream) {
              if (settled) throw new SkillPackageError("文件包校验已停止。");
              size += chunk.length; total += chunk.length;
              if (size > SKILL_LIMITS.fileBytes || total > SKILL_LIMITS.expandedBytes) throw new SkillPackageError("文件包解压后超过限制。");
              chunks.push(chunk);
            }
          } finally { stream.destroy(); }
          if (size !== entry.uncompressedSize) throw new SkillPackageError("文件实际大小与清单不符。");
          const content = Buffer.concat(chunks);
          if (crc32(content) !== entry.crc32) throw new SkillPackageError("ZIP 文件校验码不符，数据可能已损坏。");
          if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(content.toString("utf8"))) throw new SkillPackageError(`文件中含有私钥：${path}`);
          raw.set(path, { bytes: content, sha256: hash(content) });
          if (!settled) zip.readEntry();
        })().catch(error => finish(error instanceof SkillPackageError ? error : new SkillPackageError("无法安全读取文件包。")));
      });
      zip.readEntry();
    });
  });
  if (!raw.size) throw new SkillPackageError("文件包为空。");
  let root = "";
  if (!raw.has("SKILL.md")) {
    const candidates = [...raw.keys()].filter(p => /^[^/]+\/SKILL\.md$/.test(p));
    if (candidates.length !== 1) throw new SkillPackageError("文件包根目录必须包含唯一的 SKILL.md。");
    root = candidates[0].slice(0, -"SKILL.md".length);
    if ([...raw.keys()].some(p => !p.startsWith(root))) throw new SkillPackageError("ZIP 只能包含一个 Skill 文件夹。");
  }
  const manifest: SkillFile[] = []; const texts = new Map<string, string>();
  for (const [path, file] of raw) {
    const relative = packagePath(path.slice(root.length));
    let text: string | null = null;
    if (textReference(relative)) {
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes); } catch { /* Binary attachments are not model input. */ }
    }
    const readable = text !== null && file.bytes.length <= SKILL_LIMITS.referenceBytes && !text.includes("\0");
    manifest.push({ path: relative, size: file.bytes.length, sha256: file.sha256, text: readable });
    if (readable) texts.set(relative, text!);
  }
  let instructions: string;
  try { instructions = new TextDecoder("utf-8", { fatal: true }).decode(raw.get(root + "SKILL.md")!.bytes); }
  catch { throw new SkillPackageError("SKILL.md 必须使用 UTF-8 文本格式。"); }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(instructions);
  if (!match || Buffer.byteLength(match[1]) > 8192) throw new SkillPackageError("SKILL.md 缺少有效的 YAML 属性区。");
  const document = parseDocument(match[1], { uniqueKeys: true, customTags: [] });
  if (document.errors.length || document.warnings.length) throw new SkillPackageError("SKILL.md 属性区格式不正确。");
  let value: unknown;
  try { value = document.toJS({ maxAliasCount: 0 }); } catch { throw new SkillPackageError("SKILL.md 属性区不支持 YAML 引用。"); }
  const pending = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 256 || current.depth > 8) throw new SkillPackageError("SKILL.md 属性区嵌套过深或过于复杂。");
    if (current.value && typeof current.value === "object")
      for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
  }
  const metadata = value as Record<string, unknown>;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || typeof metadata.name !== "string" || typeof metadata.description !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name) || metadata.name.length > 64 || !metadata.description.trim() || metadata.description.length > 1024)
    throw new SkillPackageError("请填写有效的 name（小写英文与连字符）和 description。");
  if (root && root.slice(0, -1) !== metadata.name) throw new SkillPackageError("Skill 文件夹名称必须与 name 一致。");
  return { name: metadata.name, description: metadata.description, sha256: hash(bytes), byteSize: bytes.length,
    manifest: manifest.sort((a, b) => a.path.localeCompare(b.path)), texts,
    onlineEligible: texts.has("SKILL.md") && Buffer.byteLength(instructions) <= SKILL_LIMITS.instructionBytes };
}
