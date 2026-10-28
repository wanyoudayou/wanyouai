import type { HandbookBinding, Inventory } from "../../../packages/handbook-protocol/src";
import { safeVaultPath } from "../../../packages/handbook-protocol/src";

export type Binding = Omit<HandbookBinding, "files"> & {
  origin: string;
  changed: boolean;
  onlineMissing?: boolean;
  onlineCheckedAt?: string;
  outcome?: "draft" | "published" | "partial";
  lastSyncedAt?: string;
  failures?: { path: string; message: string; kind?: "file" | "completion" }[];
  files: Record<string, HandbookBinding["files"][string] & { publishedVersion?: number; draftVersion?: number; onlineStatus?: string }>;
};

/** Loading folders records paths only; online creation remains a separate action. */
export function loadFolders(current: string[], requested: string[]) {
  const folders = [...current]; const added: string[] = []; const skipped: string[] = [];
  for (const path of requested) {
    safeVaultPath(path);
    const overlap = folders.find(p => p === path);
    if (overlap) { skipped.push(`${path}（已载入）`); continue; }
    folders.push(path); added.push(path);
  }
  return { folders, added, skipped };
}

export function inventoryFiles(inventory: Inventory): Binding["files"] {
  return Object.fromEntries(inventory.files.map(f => [f.path, {
    slug: f.article_slug, version: f.latest?.version ?? 0, hash: f.latest?.input_hash ?? "",
    publishedVersion: f.online?.version ?? (f.online === undefined ? f.latest?.publication?.article?.version : undefined),
    onlineStatus: f.online?.status,
    draftVersion: f.latest && !f.latest.publication?.article ? f.latest.version : undefined,
  }]));
}
export function versionLabel(binding: Binding) {
  const files = Object.values(binding.files);
  const published = files.map(f => f.publishedVersion).filter((v): v is number => !!v);
  const drafts = files.filter(f => f.draftVersion || (!f.publishedVersion && f.version > 0)).map(f => f.draftVersion ?? f.version);
  const range = (label: string, values: number[]) => {
    const low = Math.min(...values), high = Math.max(...values);
    return `${label}：v${low}${high === low ? "" : `–v${high}`}（${values.length} 篇）`;
  };
  return [published.length ? range("已发布版本", published) : "", drafts.length ? range("草稿修订", drafts) : ""].filter(Boolean).join("；") || "尚无线上版本";
}
export function statusLabel(binding?: Binding) {
  if (!binding) return "待创建线上手册";
  if (binding.onlineMissing) return "线上手册不存在或已归档，请解除本机绑定后重新上传";
  if (binding.failures?.length) return binding.failures.some(f => f.kind === "completion") ? "有未完成操作，请查看处理方式" : `部分完成 · ${binding.failures.length} 篇待处理`;
  if (binding.changed) return "待比对本地更新";
  const files = Object.values(binding.files);
  if (files.some(f => f.draftVersion)) return "草稿已上传，待网页发布";
  if (files.length && files.every(f => f.publishedVersion)) return "已同步线上发布";
  if (binding.outcome === "draft") return "已保存线上草稿";
  return "已同步";
}
