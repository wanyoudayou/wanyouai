/** 站点导出内容编排：纯函数，由查询行集生成 ZIP 条目清单。无服务端依赖。 */
import { buildCsv, type ZipEntry } from "@/lib/admin/export-zip";
import { stringify } from "yaml";

export type ExportData = {
  siteConfig: unknown;
  series: { id: number; slug: string; title: string; type: string; status: string; price: number | string; published_at?: string | null }[];
  articles: {
    id: number; slug: string; title: string; type: string; access: string; status: string;
    price: number | string | null; series_id: number | null; published_at: string | null;
  }[];
  bodies: { article_id: number; content: string }[];
  orders: { id: number; merchant_order_no: string; user_id: string; sku_type: string; target_id: number | null; amount: number | string; status: string; created_at: string }[];
  entitlements: { id: number; user_id: string; type: string; target_id: number | null; ends_at: string | null; revoked_at: string | null; source: string; created_at: string }[];
  registrations: { id: number; series_id: number; email: string; status: string; created_at: string }[];
  services: Record<string, unknown>[];
  bookings: Record<string, unknown>[];
  evaluations: Record<string, unknown>[];
  customPages: Record<string, unknown>[];
  userEmails: Record<string, string>;
};

function frontmatter(fields: [string, string | number | null][]): string {
  const metadata = Object.fromEntries(fields.filter(([, value]) => value !== null));
  return "---\n" + stringify(metadata, { blockQuote: false }) + "---\n\n";
}

function articleMarkdown(article: ExportData["articles"][number], seriesSlug: string | null, body: string): string {
  return frontmatter([
    ["title", article.title],
    ["slug", article.slug],
    ["type", article.type],
    ["access", article.access],
    ["status", article.status],
    ["series", seriesSlug],
    ["price", article.price === null ? null : String(article.price)],
    ["published_at", article.published_at],
  ]) + body + "\n";
}

/** 编排导出条目：content/ Markdown + data/ CSV + site_config.json。 */
export function composeExport(data: ExportData): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const seriesById = new Map(data.series.map((s) => [s.id, s]));
  const bodyByArticle = new Map(data.bodies.map((b) => [b.article_id, b.content]));
  for (const article of data.articles) {
    const series = article.series_id === null ? null : seriesById.get(article.series_id) ?? null;
    const dir = series ? `content/${series.slug}` : "content/_standalone";
    const body = bodyByArticle.get(article.id) ?? "";
    entries.push({ path: `${dir}/${article.slug}.md`, content: articleMarkdown(article, series?.slug ?? null, body) });
  }
  entries.push({ path: "site_config.json", content: JSON.stringify(data.siteConfig, null, 2) + "\n" });
  const emailOf = (uid: string) => data.userEmails[uid] ?? uid;
  entries.push({
    path: "data/orders.csv",
    content: buildCsv(["id", "merchant_order_no", "user_email", "sku_type", "target_id", "amount", "status", "created_at"],
      data.orders.map((o) => [o.id, o.merchant_order_no, emailOf(o.user_id), o.sku_type, o.target_id, String(o.amount), o.status, o.created_at])),
  });
  entries.push({
    path: "data/entitlements.csv",
    content: buildCsv(["id", "user_email", "type", "target_id", "ends_at", "revoked_at", "source", "created_at"],
      data.entitlements.map((e) => [e.id, emailOf(e.user_id), e.type, e.target_id, e.ends_at, e.revoked_at, e.source, e.created_at])),
  });
  entries.push({
    path: "data/registrations.csv",
    content: buildCsv(["id", "series_id", "email", "status", "created_at"],
      data.registrations.map((r) => [r.id, r.series_id, r.email, r.status, r.created_at])),
  });
  const genericCsv = (name: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const keys = Object.keys(rows[0]);
    entries.push({ path: `data/${name}.csv`, content: buildCsv(keys, rows.map((r) => keys.map((k) => r[k] === null || r[k] === undefined ? "" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])))) });
  };
  genericCsv("services", data.services);
  genericCsv("bookings", data.bookings);
  genericCsv("evaluations", data.evaluations);
  genericCsv("custom_pages", data.customPages);
  // 自定义页面 HTML 正文单独成文件（与 CSV 元数据互补）
  for (const page of data.customPages) {
    const slug = typeof page.slug === "string" ? page.slug : null;
    const html = typeof page.html === "string" ? page.html : null;
    if (slug && html) entries.push({ path: `pages/${slug}.html`, content: html + "\n" });
  }
  return entries;
}
