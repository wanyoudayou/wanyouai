import { seriesPath, isSeriesType } from "@/lib/content-kinds";
import { findSection, sectionPath, type SectionAccess } from "@/lib/sections/registry";
import type { NavEntry, NavGroup, NavItemKind, NavLink } from "./types";

export interface PublicNavRow {
  id: number;
  parent_id: number | null;
  kind: NavItemKind;
  label: string;
  icon: string;
  url: string | null;
  page_slug: string | null;
  series_slug: string | null;
  series_type: string | null;
  section: string | null;
  access: SectionAccess;
}

/** 公开投影 → 前台链接；目标不存在于本次部署（栏目）或无法解析时跳过。 */
export function toNavLink(
  row: PublicNavRow,
  registered: (name: string) => boolean = (name) => findSection(name) !== null,
): NavLink | null {
  if (row.kind === "group") return null;
  const base = { label: row.label, icon: row.icon, kind: row.kind };
  if (row.kind === "external")
    return row.url?.startsWith("https://") ? { ...base, href: row.url, external: true } : null;
  if (row.kind === "page")
    return row.page_slug ? { ...base, href: `/p/${row.page_slug}`, external: false } : null;
  if (row.kind === "series")
    return row.series_slug && row.series_type && isSeriesType(row.series_type)
      ? { ...base, href: seriesPath({ type: row.series_type, slug: row.series_slug }), external: false }
      : null;
  return row.section && registered(row.section)
    ? { ...base, href: sectionPath(row.section), external: false }
    : null;
}

/**
 * 公开投影 → 前台两级导航。父级目录保持自己的位置，子项按顺序归入所属目录；
 * 子项无法解析时跳过，没有可见子项的目录不显示。
 */
export function buildNavigation(
  rows: readonly PublicNavRow[],
  registered?: (name: string) => boolean,
): NavEntry[] {
  const groups = new Map<number, NavGroup>();
  for (const row of rows)
    if (row.kind === "group" && row.parent_id === null)
      groups.set(row.id, { kind: "group", key: `group-${row.id}`, label: row.label, icon: row.icon, children: [] });
  const entries: NavEntry[] = [];
  for (const row of rows) {
    if (row.kind === "group") {
      const group = groups.get(row.id);
      if (group) entries.push(group);
      continue;
    }
    const link = toNavLink(row, registered);
    if (!link) continue;
    if (row.parent_id === null) entries.push(link);
    else groups.get(row.parent_id)?.children.push(link);
  }
  return entries.filter((entry) => entry.kind !== "group" || entry.children.length > 0);
}
