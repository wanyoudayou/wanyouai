/** Pure wire contract: no Next.js, Obsidian, credentials, or server dependencies. */
export const HANDBOOK_PROTOCOL = 1;
export const HANDBOOK_DRAFT_WRITES = ["create", "compare", "stage", "rename", "media-prepare", "media-finish"] as const;
export const isHandbookDraftWrite = (action: string) => (HANDBOOK_DRAFT_WRITES as readonly string[]).includes(action);
export type Handbook = { id: number; slug: string; title: string; status: string; updated_at: string; readme_article_id: number | null };
export type FileBinding = { id: number; path: string; article_slug: string; online?: { id: number; title: string; status: string; version: number; updated_at: string } | null; latest: { id: number; version: number; input_hash: string; publication: { status: string; article: { version: number; url: string } | null } | null } | null };
export type OnlineArticle = { id: number; slug: string; title: string; status: string; version: number; updated_at: string };
export type Inventory = { files: FileBinding[]; assets: { path: string; source_hash: string }[]; onlineArticles?: OnlineArticle[]; total: number; page: number };
export type ConnectionInfo = { protocol: number; scope: string; uploadOrigin: string; publicKey: string; imagesPublic: boolean; capabilities?: string[] };
export type HandbookBinding = { folder: string; series: Handbook; digest: string; images: string[]; files: Record<string, { slug: string; version: number; hash: string }> };
export function siteOrigin(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) throw new Error("请填写 HTTPS 站点首页地址，不带路径、参数或凭据。");
  return url.origin;
}
export function safeVaultPath(path: string) {
  if (!path || path.startsWith("/") || /[\\\u0000-\u001f:]/.test(path) || path.split("/").some(p => !p || p === "." || p === ".." || p.startsWith("."))) throw new Error("仅支持当前笔记库内的普通文件路径。");
  return path;
}
export function operationMatches(expected: { hash: string; action: string }, actual: { hash: string; action: string }) { return expected.hash === actual.hash && expected.action === actual.action; }
