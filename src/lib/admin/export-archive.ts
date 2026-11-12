import { createHash } from "node:crypto";
import { buildZip, type ZipEntry } from "./export-zip";
import { composeExport, type ExportData } from "./export-compose";
import { EXPORT_TABLES, EXPORT_OMITTED_TABLES, type ExportTable } from "./export-pagination";

export type ExportRows = Record<ExportTable, Record<string, unknown>[]>;
export type ExportUser = {
  id: string; email?: string | null; phone?: string | null; created_at?: string | null;
  updated_at?: string | null; last_sign_in_at?: string | null; email_confirmed_at?: string | null;
  app_metadata?: unknown; user_metadata?: unknown;
};
export type ExportConsistency = { mode: "single_statement_snapshot"; captured_at: string } | { mode: "non_atomic" };

/** Pure archive assembly shared by the owner export and isolated scale acceptance. */
export function buildSiteExportArchive(rows: ExportRows, users: ExportUser[], now = new Date(), consistency: ExportConsistency = { mode: "non_atomic" }): Uint8Array {
  if (rows.site_config.length !== 1 || rows.app_schema_version.length !== 1) throw new Error("导出站点配置或数据库版本异常");
  const userEmails: Record<string, string> = {};
  for (const user of users) userEmails[user.id] = user.email ?? user.id;
  const data: ExportData = {
    siteConfig: rows.site_config[0],
    series: rows.series as unknown as ExportData["series"],
    articles: rows.articles as unknown as ExportData["articles"],
    bodies: rows.article_bodies as unknown as ExportData["bodies"],
    orders: rows.orders as unknown as ExportData["orders"],
    entitlements: rows.entitlements as unknown as ExportData["entitlements"],
    registrations: rows.registrations as unknown as ExportData["registrations"],
    services: rows.services,
    bookings: rows.bookings,
    evaluations: rows.evaluations,
    customPages: rows.custom_pages,
    userEmails,
  };
  const entries: ZipEntry[] = composeExport(data);
  for (const table of EXPORT_TABLES) {
    entries.push({ path: `data/raw/${table}.json`, content: JSON.stringify(rows[table], null, 2) + "\n" });
  }
  entries.push({ path: "data/auth-users.json", content: JSON.stringify(users.map((user) => ({
    id: user.id, email: user.email, phone: user.phone, created_at: user.created_at,
    updated_at: user.updated_at, last_sign_in_at: user.last_sign_in_at,
    email_confirmed_at: user.email_confirmed_at,
    app_metadata: user.app_metadata, user_metadata: user.user_metadata,
  })), null, 2) + "\n" });
  entries.push({ path: "EXPORT-INFO.txt", content: [
    "万有AI 内容与业务数据导出", `导出时间: ${now.toISOString()}`,
    `数据库版本: ${String(rows.app_schema_version[0].version)}`,
    `应用表: ${EXPORT_TABLES.length} 张；Auth 用户: ${users.length} 名`,
    "使用方法：解压后用 Markdown 编辑器打开 content/ 中的文章；用表格软件按 UTF-8 导入 data/ 中的 CSV，进行查询、统计或对账。",
    "pages/ 中的 HTML 可用于取回页面源码；site_config.json 与 data/raw/ 用于人工查阅和开发者分析。",
    "图片和附件仅保留引用，离线使用需另存原件；文章头部是留存元数据，重新发布前需按发布契约整理。",
    "本系统不支持把此 ZIP 整包导入来恢复站点、账号或订单权益。",
    "此 ZIP 不含 site_secrets、Auth 密码与令牌、Storage 对象字节；不能代替灾难恢复备份。",
    consistency.mode === "single_statement_snapshot" ? `应用表与 Auth 资料来自同一数据库查询快照，查询开始时间: ${consistency.captured_at}` : "此归档未声明数据库快照一致性。",
    "完整性清单见 EXPORT-MANIFEST.json。",
    "",
  ].join("\n") });
  const encoder = new TextEncoder();
  const manifest = {
    format: "wanyou.export/1", exported_at: now.toISOString(),
    consistency,
    schema_version: String(rows.app_schema_version[0].version),
    row_counts: Object.fromEntries(EXPORT_TABLES.map((table) => [table, rows[table].length])),
    auth_users: users.length,
    omitted_public_tables: EXPORT_OMITTED_TABLES,
    excludes: ["Auth passwords and tokens", "Storage object bytes"],
    files: entries.map((entry) => {
      const content = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
      return { path: entry.path, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") };
    }),
  };
  entries.push({ path: "EXPORT-MANIFEST.json", content: JSON.stringify(manifest, null, 2) + "\n" });
  return buildZip(entries, now);
}
