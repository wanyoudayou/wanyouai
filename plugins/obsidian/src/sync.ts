import { randomUUID } from "node:crypto";
import { HandbookNetworkError, HandbookRequestError, type HandbookClient } from "./client";
import { digest, type Snapshot, type NoteSnapshot } from "./snapshot";
import type { Handbook, Inventory, ConnectionInfo } from "../../../packages/handbook-protocol/src";

export type Journal = Record<string, { id: string; action: string; hash: string; done: boolean }>;
export type Recovery = { confirmed: number; unfinished: number; blocked: number };
export type Check = { hash: string; updatedAt: string | null; expected: number; version: number; previousAccess: string | null; accessChanged: boolean; onlineChanged: boolean; change: string; input: NoteSnapshot["candidate"]["input"]; previousMarkdown: string; previousMarkdownSource?: "draft" | "published" };
export type Compared = { note: NoteSnapshot; check?: Check; error?: string };
export const requiresOverwrite = (item: Compared) => !!item.check && (item.check.onlineChanged || ["changed", "existing"].includes(item.check.change));
export const needsDraftUpload = (item: Compared, inventory: Inventory) => item.check?.change !== "unchanged" || !inventory.files.some(file => file.path === item.note.path && file.latest);
export class PartialSyncError extends Error {
  constructor(readonly failures: { path: string; message: string }[], readonly completed: number, readonly total: number) {
    super(`已上传草稿 ${completed}/${total} 篇，${failures.length} 篇未完成。请重新比对后继续上传；成功内容会自动跳过。`);
  }
}
export class Sync {
  constructor(readonly client: HandbookClient, private journal: Journal, private save: () => Promise<void>, private progress: (text: string) => void) {}
  /** Read-only recovery of this handbook's existing tasks; never starts another write. */
  async reconcile(slug: string): Promise<Recovery> {
    const pending = Object.entries(this.journal).filter(([key, entry]) => key.startsWith(`series:${slug}:`) && !entry.done && entry.action !== "image");
    const result: Recovery = { confirmed: 0, unfinished: 0, blocked: 0 };
    for (const [index, [, entry]] of pending.entries()) {
      this.progress(`正在查询原任务（${index + 1}/${pending.length}）…`);
      const status = await this.client.get<{ operation: { response: unknown } | null }>("status", { id: entry.id });
      if (!status.operation?.response) { result.unfinished++; continue; }
      const response = status.operation.response;
      if (typeof response === "object" && "status" in response && response.status === "blocked") result.blocked++;
      else result.confirmed++;
      entry.done = true; await this.save();
    }
    return result;
  }
  async operation<T>(key: string, action: string, body: Record<string, unknown>): Promise<T> {
    const hash = digest(JSON.stringify({ action, body })); let entry: Journal[string] | undefined = this.journal[key];
    if (entry) {
      const status = await this.client.get<{ operation: { response: T | null } | null }>("status", { id: entry.id });
      if (entry.hash === hash && status.operation?.response) { entry.done = true; await this.save(); return status.operation.response; }
      if (entry.hash !== hash && !entry.done && !status.operation?.response) throw new Error("上次操作尚未确认且本地内容已变化。请保留原文，在站点核对后解除该文件夹绑定；不要覆盖线上内容。");
      if (entry.hash !== hash) entry = undefined;
    }
    if (!entry) { entry = { id: randomUUID(), action, hash, done: false }; this.journal[key] = entry; await this.save(); }
    // Only a deliberate user retry reaches this call; no automatic retries after an unknown response.
    let result: T;
    try { result = await this.client.post<T>(action, { ...body, operationId: entry.id }); }
    catch (error) {
      if (error instanceof HandbookNetworkError || (error instanceof HandbookRequestError && error.status >= 500)) {
        this.progress("响应中断，正在查询原任务是否已完成…");
        try {
          const status = await this.client.get<{ operation: { response: T | null } | null }>("status", { id: entry.id });
          if (status.operation?.response) { entry.done = true; await this.save(); return status.operation.response; }
        } catch { /* Preserve the original phase/code. Only reads were attempted; the write is never retried here. */ }
      }
      throw error;
    }
    entry.done = true; await this.save(); return result;
  }
  async inventory(slug: string): Promise<Inventory> {
    const result: Inventory = { files: [], assets: [], onlineArticles: [], total: 0, page: 1 };
    for (let page = 1; ; page++) {
      const next = await this.client.get<Inventory>("inventory", { scope: `series:${slug}`, page: String(page) });
      result.files.push(...next.files); result.assets.push(...next.assets); result.total = next.total;
      result.onlineArticles!.push(...(next.onlineArticles ?? []));
      if (page * 100 >= next.total) { for (const file of result.files) file.online = result.onlineArticles!.find(a => a.slug === file.article_slug) ?? null; return result; }
    }
  }
  async compare(snapshot: Snapshot): Promise<Compared[]> {
    const result: Compared[] = [];
    for (const note of snapshot.notes) {
      this.progress(`当前比对进度（${result.length + 1}/${snapshot.notes.length}）：${note.path}`);
      result.push(await this.compareNote(note));
    }
    return result;
  }
  async compareNote(note: NoteSnapshot): Promise<Compared> {
    try { return { note, check: await this.client.post<Check>("compare", { candidate: note.candidate, draftUpload: true }) }; }
    catch (error) { return { note, error: (error as Error).message }; }
  }
  async saveDrafts(snapshot: Snapshot, compared: Compared[], series: Handbook, inventory: Inventory, connection: ConnectionInfo, overwrites = new Set<string>()) {
    if (compared.some(item => item.error || !item.check || (requiresOverwrite(item) && !overwrites.has(item.note.path)))) throw new Error("请处理比对错误，并逐项确认需要覆盖的线上修改。");
    const scope = `series:${series.slug}`;
    const progress = (phase: number, text: string) => this.progress(`当前上传进度（${phase}/3）：${text}`);
    progress(1, `检查 ${snapshot.images.length} 张引用图片`);
    for (const [index, image] of snapshot.images.entries()) {
      if (inventory.assets.some(a => a.path === image.path && a.source_hash === image.hash)) continue;
      progress(1, `上传图片 ${index + 1}/${snapshot.images.length}：${image.vaultPath}`);
      const key = `${scope}:image:${image.hash}`;
      if (!this.journal[key]) { this.journal[key] = { id: randomUUID(), action: "image", hash: image.hash, done: false }; await this.save(); }
      const id = this.journal[key].id;
      try {
      const prepared = await this.client.post<{ signedUrl?: string }>("media-prepare", { scope, id, name: image.vaultPath.split("/").pop(), sha256: image.hash, mime: image.mime, size: image.bytes.byteLength });
      if (prepared.signedUrl) await this.client.upload(prepared.signedUrl, image.bytes, image.mime, connection);
      await this.client.post("media-finish", { scope, id, path: image.path, expected: inventory.assets.find(a => a.path === image.path)?.source_hash ?? null });
      this.journal[key].done = true; await this.save();
      } catch (error) {
        if (error instanceof HandbookRequestError && error.code === "UPLOAD_EXPIRED") {
          delete this.journal[key]; await this.save();
          throw new Error("图片上传凭据已过期，原文件未发布。请重新比对并确认同步，以申请新的上传凭据。");
        }
        throw new Error(`图片 ${image.vaultPath} 未完成：${(error as Error).message}。恢复连接或修正图片后，点击“重新比对未完成项”。`);
      }
    }
    const failures: { path: string; message: string }[] = [];
    let completed = 0;
    for (const [index, item] of compared.entries()) {
      item.error = undefined;
      const check = item.check!;
      if (!needsDraftUpload(item, inventory)) { completed++; continue; }
      progress(2, `保存文稿 ${index + 1}/${compared.length}：${item.note.path}`);
      try {
        await this.operation<{ id: number }>(`${scope}:stage:${item.note.path}:${check.hash}:${check.expected}:${check.updatedAt ?? "new"}`, "stage", { candidate: item.note.candidate, checkedHash: check.hash, expected: check.expected, updatedAt: check.updatedAt, draftUpload: true, overwriteOnline: requiresOverwrite(item) && overwrites.has(item.note.path) });
        completed++;
      } catch (error) { item.error = (error as Error).message; failures.push({ path: item.note.path, message: item.error }); }
    }
    if (failures.length) throw new PartialSyncError(failures, completed, compared.length);
    progress(3, "读取线上草稿和已发布状态");
    return this.inventory(series.slug);
  }
}
