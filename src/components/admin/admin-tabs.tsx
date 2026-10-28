import Link from "next/link";
export type AdminTab =
  | "blog"
  | "albums"
  | "users"
  | "inbox"
  | "pages"
  | "card"
  | "services"
  | "orders"
  | "settings"
  | "setup";
const labels: Record<AdminTab, string> = {
  blog: "文章",
  albums: "专辑",
  users: "用户与权益",
  inbox: "收件箱",
  pages: "独立页面",
  card: "站主名片",
  services: "服务项目",
  orders: "服务履约",
  settings: "首页与导航",
  setup: "部署检查",
};
export function AdminTabs({ active }: { active: AdminTab }) {
  return (
    <nav
      aria-label="当前位置"
      className="flex gap-2 text-sm text-muted-foreground"
    >
      <Link href="/admin" className="text-primary hover:underline">
        概览
      </Link>
      <span aria-hidden>/</span>
      <span>{labels[active]}</span>
    </nav>
  );
}
