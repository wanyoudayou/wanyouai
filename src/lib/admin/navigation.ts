import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAdminIdentity } from "@/lib/admin/session";
import { SECTIONS, findSection, sectionPath, type SectionEntry } from "@/lib/sections/registry";
import { seriesPath, isSeriesType, SERIES_LABEL } from "@/lib/content-kinds";
import type { NavItemInput } from "@/lib/navigation/validate";

export interface NavTargetOption {
  id: number;
  title: string;
  href: string;
  live: boolean;
  /** 列表中的辅助说明，例如“手册 · 已上架”。 */
  note: string;
}

export interface AdminNavRow extends NavItemInput {
  id: number;
  /** 后台展示用目标地址与问题提示；不参与保存。 */
  href: string;
  problem: string | null;
}

export interface NavigationAdminData {
  version: string;
  rows: AdminNavRow[];
  pages: NavTargetOption[];
  series: NavTargetOption[];
  sections: SectionEntry[];
  commit: string | null;
}

const PAGE_STATUS: Record<string, string> = { draft: "草稿", published: "已发布", archived: "已归档" };
const SERIES_STATUS: Record<string, string> = { draft: "未上架", published: "已上架", paused: "已暂停", archived: "已归档" };

/** 站主导航管理：读取全部导航项、可选目标和本次部署的代码栏目登记表。 */
export async function loadNavigationAdmin(): Promise<NavigationAdminData> {
  if (!(await getAdminIdentity()).owner) throw new Error("需要站主身份");
  const client = await createSupabaseServerClient();
  const [items, version, pages, series] = await Promise.all([
    client
      .from("nav_items")
      .select("id,parent_id,kind,label,icon,url,page_id,series_id,section,access,enabled,sort_order")
      .order("sort_order")
      .order("id")
      .limit(100),
    client.rpc("nav_items_version"),
    client.from("custom_pages").select("id,slug,title,status").neq("status", "archived").order("title").limit(500),
    client.from("series").select("id,slug,title,type,status").neq("status", "archived").order("title").limit(500),
  ]);
  if (items.error || version.error || pages.error || series.error || typeof version.data !== "string")
    throw new Error("导航暂时无法读取，请稍后重试");
  const pageOptions: NavTargetOption[] = (pages.data ?? []).map((page) => ({
    id: Number(page.id),
    title: String(page.title),
    href: `/p/${page.slug}`,
    live: page.status === "published",
    note: PAGE_STATUS[String(page.status)] ?? String(page.status),
  }));
  const seriesOptions: NavTargetOption[] = (series.data ?? [])
    .filter((row) => isSeriesType(String(row.type)))
    .map((row) => ({
      id: Number(row.id),
      title: String(row.title),
      href: seriesPath({ type: String(row.type), slug: String(row.slug) }),
      live: ["published", "paused"].includes(String(row.status)),
      note: `${SERIES_LABEL[String(row.type) as keyof typeof SERIES_LABEL] ?? "专辑"} · ${SERIES_STATUS[String(row.status)] ?? String(row.status)}`,
    }));
  // 父级目录之后紧跟它的子项，与保存时的扁平顺序一致。
  const all = items.data ?? [];
  const ordered = all.flatMap((row) =>
    row.parent_id !== null ? [] : [row, ...all.filter((child) => child.parent_id === row.id)],
  );
  const rows: AdminNavRow[] = ordered.map((row) => {
    const base = {
      id: Number(row.id),
      kind: row.kind,
      label: String(row.label),
      icon: String(row.icon),
      url: row.url,
      page_id: row.page_id === null ? null : Number(row.page_id),
      series_id: row.series_id === null ? null : Number(row.series_id),
      section: row.section,
      access: row.access,
      enabled: row.enabled === true,
      child: row.parent_id !== null,
    } as NavItemInput & { id: number };
    if (base.kind === "group") {
      const count = all.filter((child) => child.parent_id === base.id).length;
      return { ...base, href: count ? `${count} 个子项` : "—", problem: count ? null : "没有子项，前台不显示" };
    }
    if (base.kind === "external") return { ...base, href: String(base.url), problem: null };
    if (base.kind === "page") {
      const page = pageOptions.find((option) => option.id === base.page_id);
      return { ...base, href: page?.href ?? "—", problem: !page ? "页面已归档" : page.live ? null : "页面未发布，前台暂不显示" };
    }
    if (base.kind === "series") {
      const item = seriesOptions.find((option) => option.id === base.series_id);
      return { ...base, href: item?.href ?? "—", problem: !item ? "专辑已归档" : item.live ? null : "专辑未上架，前台暂不显示" };
    }
    const section = base.section ? findSection(base.section) : null;
    return {
      ...base,
      href: base.section ? sectionPath(base.section) : "—",
      problem: section ? null : "本次部署中不存在，前台已隐藏",
    };
  });
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null;
  return { version: version.data, rows, pages: pageOptions, series: seriesOptions, sections: SECTIONS, commit };
}
