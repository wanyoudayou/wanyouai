/** 指向具体目标的导航类型。 */
export type NavTargetKind = "external" | "page" | "series" | "section";
/** 后台可编辑的全部类型；`group` 是可折叠的父级目录，本身没有目标。 */
export type NavItemKind = NavTargetKind | "group";

/** 前台导航链接：只含渲染所需的公开字段。 */
export interface NavLink {
  href: string;
  label: string;
  icon: string;
  kind: NavTargetKind;
  external: boolean;
}

/** 前台父级目录：展开后显示子项（只有一层）。 */
export interface NavGroup {
  kind: "group";
  key: string;
  label: string;
  icon: string;
  children: NavLink[];
}

export type NavEntry = NavLink | NavGroup;

/** 展开父级目录后的全部链接，用于激活匹配与目标查找。 */
export function navLinks(entries: readonly NavEntry[]): NavLink[] {
  return entries.flatMap((entry) => (entry.kind === "group" ? entry.children : [entry]));
}
