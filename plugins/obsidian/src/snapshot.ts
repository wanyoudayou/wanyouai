import { createHash } from "node:crypto";
import { posix } from "node:path";
import { importMarkdown } from "../../../src/lib/admin/draft";
import { imageMime, localReferences, normalizeEmbeds } from "../../../src/lib/importing/paths";
import { inspectMarkdown } from "../../../src/lib/publishing/markdown";
import { safeVaultPath, type Inventory } from "../../../packages/handbook-protocol/src";
import type { PublishInput } from "../../../src/lib/publishing/types";
import { findReadme } from "./readme";

export const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export type VaultReader = {
  markdownFiles(folder: string): string[];
  readText(path: string): Promise<string>;
  resolve(reference: string, source: string): string | null;
  readImage(path: string): Promise<Uint8Array>;
};
export type ImageSnapshot = { vaultPath: string; path: string; hash: string; bytes: Uint8Array; mime: string };
export type NoteSnapshot = { path: string; sourceHash: string; candidate: { scope: string; path: string; input: PublishInput; hashes: Record<string, string>; folder: true } };
export type Snapshot = { digest: string; notes: NoteSnapshot[]; images: ImageSnapshot[]; ignored: string[] };

/** Only selected notes and their resolved images are read; embedded notes are never expanded. */
export async function snapshot(reader: VaultReader, folder: string, slug: string, inventory: Inventory): Promise<Snapshot> {
  safeVaultPath(folder);
  const available = reader.markdownFiles(folder);
  const paths = available.filter(p => p.startsWith(folder + "/") && !p.slice(folder.length + 1).includes("/") && !p.slice(folder.length + 1).startsWith(".")).sort();
  if (!findReadme(paths, folder)) throw new Error("所选文件夹根目录缺少 README.md；它是全文公开的手册介绍。");
  if (paths.length > 1000) throw new Error("一次最多同步 1000 篇笔记，请拆分手册。");
  const images = new Map<string, ImageSnapshot>(); const notes: NoteSnapshot[] = []; const ignored: string[] = [];
  const skipped = available.filter(p => p.startsWith(folder + "/") && !paths.includes(p)).length;
  if (skipped) ignored.push(`已忽略子目录或隐藏目录中的 ${skipped} 篇笔记；仅上传根目录文稿及其引用图片。`);
  let bytesRead = 0;
  for (const sourcePath of paths) {
    safeVaultPath(sourcePath);
    const path = sourcePath.slice(folder.length + 1); const source = await reader.readText(sourcePath);
    bytesRead += Buffer.byteLength(source); if (bytesRead > 50 * 1024 * 1024) throw new Error("笔记文字总量超过 50 MiB，请拆分手册。");
    let parsed: ReturnType<typeof importMarkdown>;
    try { parsed = importMarkdown(source, posix.basename(path), "handbook"); }
    catch (error) { throw new Error(`${path}：${error instanceof Error ? error.message : "文稿格式无法解析。"}`); }
    if (parsed.ignored.length) ignored.push(`${path}：忽略属性 ${parsed.ignored.join("、")}`);
    const fm = { ...parsed.frontmatter, type: "chapter" as const, series_slug: slug }; delete fm.price;
    const binding = inventory.files.find(f => f.path === path);
    if (!parsed.explicitFields.includes("slug")) fm.slug = binding?.article_slug ?? "";
    // Schema placeholders only: the draft-upload server preserves authoritative access.
    fm.access = path.toLowerCase() === "readme.md" ? "public" : "registered";
    if (parsed.explicitFields.includes("access")) ignored.push(`${path}：阅读权限由网页后台管理，本地 access 不会修改线上权限。`);
    let markdown = normalizeEmbeds(parsed.markdown);
    const replacements = new Map<string, string>(); const hashes: Record<string, string> = {};
    for (const reference of localReferences(markdown, fm.cover)) {
      let decoded: string; try { decoded = decodeURIComponent(reference); } catch { throw new Error(`${path}：图片路径编码无效。`); }
      const resolved = reader.resolve(decoded, sourcePath);
      if (!resolved) throw new Error(`${path}：找不到图片 ${reference}。`);
      safeVaultPath(resolved);
      const mime = imageMime(resolved); if (!mime) throw new Error(`${path}：只支持图片附件；请移除 ${reference} 的嵌入。`);
      let image = images.get(resolved);
      if (!image) {
        const bytes = await reader.readImage(resolved);
        if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw new Error(`${resolved}：图片须为 10 MiB 以内。`);
        if (images.size >= 500 || [...images.values()].reduce((sum, i) => sum + i.bytes.byteLength, 0) + bytes.byteLength > 50 * 1024 * 1024) throw new Error("引用图片总量超过 500 张或 50 MiB，请拆分同步。");
        const hash = digest(bytes); const extension = posix.extname(resolved).toLowerCase();
        image = { vaultPath: resolved, path: `_assets/${hash}${extension}`, hash, bytes, mime }; images.set(resolved, image);
      }
      hashes[image.path] = image.hash;
      replacements.set(reference, posix.relative(posix.dirname(path), image.path));
    }
    for (const image of inspectMarkdown(markdown, "public").images.reverse()) {
      const next = replacements.get(image.url); if (!next) continue;
      markdown = markdown.slice(0, image.start) + `![${image.alt.replace(/[\\\[\]\r\n]/g, " ")}](<${next}>)` + markdown.slice(image.end);
    }
    if (fm.cover && replacements.has(fm.cover)) fm.cover = replacements.get(fm.cover);
    const input: PublishInput = { client_request_id: "handbook-preview", frontmatter: fm, markdown, media: [] };
    notes.push({ path, sourceHash: digest(source), candidate: { scope: `series:${slug}`, path, input, hashes, folder: true } });
  }
  return { digest: digest(JSON.stringify({ notes: notes.map(n => [n.path, n.sourceHash]), images: [...images.values()].map(i => [i.vaultPath, i.hash]).sort() })), notes, images: [...images.values()], ignored };
}
