import { isNavIconName } from "./icons";
import type { NavItemKind } from "./types";

export type NavAccess = "public" | "login" | "subscriber";

/** 后台编辑与保存时的导航项（与 save_nav_items 的 JSON 形状一致）。 */
export interface NavItemInput {
  kind: NavItemKind;
  label: string;
  icon: string;
  url: string | null;
  page_id: number | null;
  series_id: number | null;
  section: string | null;
  access: NavAccess;
  enabled: boolean;
  /** 归入前面最近的父级目录（`group`）；父级目录本身不能是子项。 */
  child: boolean;
}

export const NAV_ITEM_LIMIT = 50;
export const NAV_LABEL_MAX = 40;
export const SECTION_NAME = /^[a-z][a-z0-9-]{1,39}$/;
const KINDS: readonly string[] = ["external", "page", "series", "section", "group"];
const ACCESS: readonly string[] = ["public", "login", "subscriber"];

function externalUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2000 || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

const id = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;

/**
 * 服务端与数据库约束同一规则：目标与类型一一对应、访问级别只用于代码栏目、
 * 同一目标只出现一次；子项紧跟在所属父级目录之后，只有一层。
 * 返回规范化后的列表或第一条可读的错误原因。
 */
export function validateNavItems(
  raw: unknown,
): { ok: true; items: NavItemInput[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "导航数据无效，请刷新后重试。" };
  if (raw.length > NAV_ITEM_LIMIT)
    return { ok: false, message: `自定义导航最多 ${NAV_ITEM_LIMIT} 项。` };
  const items: NavItemInput[] = [];
  const seen = new Set<string>();
  let inGroup = false;
  for (const [index, value] of raw.entries()) {
    const row = (value ?? {}) as Record<string, unknown>;
    const at = `第 ${index + 1} 项`;
    const kind = String(row.kind ?? "");
    if (!KINDS.includes(kind)) return { ok: false, message: `${at}：类型无效。` };
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label || [...label].length > NAV_LABEL_MAX)
      return { ok: false, message: `${at}：请填写 ${NAV_LABEL_MAX} 字以内的名称。` };
    const icon = typeof row.icon === "string" && isNavIconName(row.icon) ? row.icon : null;
    if (!icon) return { ok: false, message: `${at}：图标不在可选范围内。` };
    const access = String(row.access ?? "public");
    if (!ACCESS.includes(access) || (kind !== "section" && access !== "public"))
      return { ok: false, message: `${at}：访问级别只适用于代码栏目。` };
    const item: NavItemInput = {
      kind: kind as NavItemKind,
      label,
      icon,
      url: null,
      page_id: null,
      series_id: null,
      section: null,
      access: access as NavAccess,
      enabled: row.enabled !== false,
      child: row.child === true,
    };
    if (kind === "group") {
      if (item.child) return { ok: false, message: `${at}：父级目录不能再放进其他目录。` };
      inGroup = true;
      items.push(item);
      continue;
    }
    if (item.child && !inGroup) return { ok: false, message: `${at}：子项需要放在父级目录之后。` };
    if (!item.child) inGroup = false;
    let key: string;
    if (kind === "external") {
      item.url = externalUrl(row.url);
      if (!item.url) return { ok: false, message: `${at}：外部链接需为完整的 https 地址。` };
      key = `url:${item.url}`;
    } else if (kind === "page") {
      item.page_id = id(row.page_id);
      if (!item.page_id) return { ok: false, message: `${at}：请选择页面。` };
      key = `page:${item.page_id}`;
    } else if (kind === "series") {
      item.series_id = id(row.series_id);
      if (!item.series_id) return { ok: false, message: `${at}：请选择专辑。` };
      key = `series:${item.series_id}`;
    } else {
      item.section = typeof row.section === "string" && SECTION_NAME.test(row.section) ? row.section : null;
      if (!item.section) return { ok: false, message: `${at}：栏目名称无效。` };
      key = `section:${item.section}`;
    }
    if (seen.has(key)) return { ok: false, message: `${at}：与前面的导航项指向同一目标。` };
    seen.add(key);
    items.push(item);
  }
  return { ok: true, items };
}
