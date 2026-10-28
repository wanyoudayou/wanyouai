"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftIcon,
  BookOpenIcon,
  BriefcaseIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
const groups = [
  {
    title: "工作台",
    Icon: LayoutDashboardIcon,
    links: [["概览", "/admin"]],
  },
  {
    title: "内容管理",
    Icon: BookOpenIcon,
    links: [
      ["文章", "/admin/articles"],
      ["专辑", "/admin/collections"],
      ["SKILL", "/admin/skills"],
      ["独立页面", "/admin/pages"],
      ["素材库", "/admin/media"],
      ["Obsidian 连接", "/admin/handbooks/connect"],
    ],
  },
  {
    title: "业务管理",
    Icon: BriefcaseIcon,
    links: [
      ["收款订单", "/admin/payments"],
      ["服务与履约", "/admin/services"],
      ["用户与权益", "/admin/users"],
      ["收件箱", "/admin/inbox"],
    ],
  },
  {
    title: "站点设置",
    Icon: SettingsIcon,
    links: [
      ["首页与导航", "/admin/settings"],
      ["站主名片", "/admin/card"],
      ["AI 设置", "/admin/ai"],
      ["安全与人机校验", "/admin/security"],
    ],
  },
  {
    title: "维护",
    Icon: WrenchIcon,
    links: [
      ["部署检查", "/admin/setup"],
      ["数据导出与维护", "/admin/maintenance"],
    ],
  },
];
export function AdminNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-5">
        <p className="font-display text-sm font-semibold">站点管理</p>
        <Link
          href="/"
          onClick={onNavigate}
          className="mt-3 inline-flex items-center gap-2 text-xs text-primary"
        >
          <ArrowLeftIcon className="size-3" />
          查看站点
        </Link>
      </div>
      <nav
        aria-label="后台管理"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3"
      >
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="mb-1.5 flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
              <group.Icon className="size-4 shrink-0" aria-hidden />
              {group.title}
            </h2>
            <ul className="space-y-1">
              {group.links.map(([label, href]) => {
                const active =
                  href === "/admin"
                    ? pathname === href
                    : pathname === href ||
                      pathname.startsWith(href + "/") ||
                      (href === "/admin/services" &&
                        pathname.startsWith("/admin/orders")) ||
                      (href === "/admin/inbox" &&
                        pathname.startsWith("/admin/conversations"));
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-lg py-2 pr-3 pl-9 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        active && "bg-accent font-medium text-primary",
                      )}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      <div className="border-t p-4">
        <ThemeToggle />
      </div>
    </div>
  );
}
