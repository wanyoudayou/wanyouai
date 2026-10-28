/** The owner export is a convenience archive. Every page must be accounted for before a ZIP is returned. */
export const EXPORT_PAGE_SIZE = 500;
export const AUTH_EXPORT_PAGE_SIZE = 200;

export const EXPORT_TABLES = [
  "app_schema_version",
  "article_bodies",
  "article_chunks",
  "article_reviews",
  "article_versions",
  "articles",
  "avatar_cache",
  "avatar_usage",
  "bookings",
  "content_assets",
  "content_file_revisions",
  "content_files",
  "conversation_messages",
  "conversation_publications",
  "conversations",
  "custom_pages",
  "email_outbox",
  "email_sends",
  "entitlements",
  "evaluations",
  "event_details",
  "inbox_items",
  "milestones",
  "media_assets",
  "orders",
  "payment_events",
  "profiles",
  "publish_requests",
  "registrations",
  "series",
  "services",
  "site_config",
  "skill_details",
  "skills",
  "skill_releases",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];
// Initialization checkpoints are operational state, not reusable site content.
export const EXPORT_OMITTED_TABLES = [
  "site_secrets",
  "starter_imports",
  "media_uploads",
  "ai_connections",
  "ai_settings",
  "ai_calls",
  "knowledge_index_control",
  "knowledge_index_generations",
  "knowledge_index_items",
  "knowledge_evaluations",
  "knowledge_question_drafts",
  "skill_uploads",
  "skill_install_grants",
  "skill_sessions",
  "skill_turns",
  "handbook_credentials",
  "handbook_sync_operations",
  "handbook_media_uploads",
] as const;

export function exportCursorColumns(table: ExportTable): readonly string[] {
  if (table === "content_assets") return ["scope", "path"];
  if (table === "article_bodies") return ["article_id"];
  if (table === "avatar_cache") return ["question_hash"];
  if (table === "conversation_publications") return ["conversation_id"];
  if (table === "event_details" || table === "skill_details")
    return ["series_id"];
  return ["id"];
}

type Row = Record<string, unknown>;
type RowPage<T> = { data: T[] | null; count?: number | null; error?: unknown };

function cursorPart(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value);
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error("导出数据主键不可安全分页");
}

function cursorOf(row: Row, keys: readonly string[]): string {
  const parts = keys.map((key) => cursorPart(row[key]));
  return keys.length === 1 ? parts[0] : JSON.stringify(parts);
}

function cursorIsAfter(
  cursor: string,
  after: string,
  keys: readonly string[],
): boolean {
  if (keys.length === 1) {
    if (/^\d+$/.test(cursor) && /^\d+$/.test(after))
      return BigInt(cursor) > BigInt(after);
    return cursor > after;
  }
  const currentParts = JSON.parse(cursor) as string[];
  const priorParts = JSON.parse(after) as string[];
  return currentParts.some(
    (part, index) =>
      part > priorParts[index] &&
      currentParts.slice(0, index).every((p, i) => p === priorParts[i]),
  );
}

/** Keyset pagination avoids offset drift. A count mismatch fails closed instead of producing a partial ZIP. */
export async function collectExportRows<T extends Row>(
  table: string,
  keys: readonly string[],
  readPage: (
    after: string | null,
    includeCount: boolean,
    pageSize: number,
  ) => Promise<RowPage<T>>,
  readFinalCount: () => Promise<{ count: number | null; error?: unknown }>,
  pageSize = EXPORT_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  let expected: number | null = null;
  let pages = 0;
  for (;;) {
    const page = await readPage(after, expected === null, pageSize);
    pages++;
    if (page.error || !Array.isArray(page.data) || page.data.length > pageSize)
      throw new Error(`导出 ${table} 读取失败`);
    if (expected === null) {
      if (!Number.isSafeInteger(page.count) || (page.count ?? -1) < 0)
        throw new Error(`导出 ${table} 缺少总数`);
      expected = page.count!;
    }
    if (page.data.length === 0 && rows.length < expected)
      throw new Error(`导出 ${table} 提前结束`);
    for (const row of page.data) {
      const cursor = cursorOf(row, keys);
      if (after !== null && !cursorIsAfter(cursor, after, keys)) {
        throw new Error(`导出 ${table} 主键顺序异常`);
      }
      after = cursor;
      rows.push(row);
    }
    if (rows.length > expected) throw new Error(`导出 ${table} 总数变化`);
    if (rows.length === expected) break;
  }
  // A single response contains both the exact count and every row. Only multi-page reads
  // need a second count to detect changes that occurred between requests.
  if (pages === 1) return rows;
  const final = await readFinalCount();
  if (final.error || final.count !== expected)
    throw new Error(`导出 ${table} 期间数据总数变化`);
  return rows;
}

type AuthPage<T> = { users: T[]; total?: number; error?: unknown };
export async function collectExportUsers<T extends { id: string }>(
  readPage: (page: number, perPage: number) => Promise<AuthPage<T>>,
  perPage = AUTH_EXPORT_PAGE_SIZE,
): Promise<T[]> {
  const users: T[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  for (let page = 1; ; page++) {
    const result = await readPage(page, perPage);
    if (
      result.error ||
      !Array.isArray(result.users) ||
      result.users.length > perPage
    )
      throw new Error("导出用户读取失败");
    if (Number.isSafeInteger(result.total) && (result.total ?? 0) > 0) {
      if (expected !== null && expected !== result.total)
        throw new Error("导出用户期间总数变化");
      expected = result.total!;
    }
    for (const user of result.users) {
      if (!user.id || seen.has(user.id))
        throw new Error("导出用户分页重复或缺少主键");
      seen.add(user.id);
      users.push(user);
    }
    if (expected !== null && users.length > expected)
      throw new Error("导出用户总数变化");
    if (result.users.length < perPage) {
      if (expected !== null && users.length !== expected)
        throw new Error("导出用户提前结束");
      return users;
    }
    if (expected !== null && users.length === expected) return users;
  }
}
