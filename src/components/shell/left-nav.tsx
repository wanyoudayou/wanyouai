"use client";

import Link from "next/link";
import { createElement, useState } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  HomeIcon,
  IdCardIcon,
  LayoutDashboardIcon,
  NewspaperIcon,
  WrenchIcon,
} from "lucide-react";

import { useReadingShell } from "@/components/reading/reading-shell";
import { ChapterTree } from "@/components/reading/chapter-tree";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SiteLogo } from "@/components/shared/site-logo";
import { SubscribePill } from "@/components/shell/subscribe-pill";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import { activeHref } from "@/lib/navigation/match";
import { navIcon } from "@/lib/navigation/icons";
import { navLinks, type NavEntry, type NavGroup, type NavLink } from "@/lib/navigation/types";

export const NAV_ITEMS = [
  { href: "/", label: "首页", Icon: HomeIcon },
  { href: "/blog", label: "博客", Icon: NewspaperIcon },
  { href: "/handbooks", label: "手册", Icon: BookOpenIcon },
  { href: "/skills", label: "技能", Icon: WrenchIcon },
  { href: "/events", label: "活动", Icon: CalendarDaysIcon },
  { href: "/services", label: "服务", Icon: BriefcaseIcon },
  { href: "/card", label: "名片", Icon: IdCardIcon },
] as const;

export interface LeftNavProps {
  owner?: boolean;
  user?: { email: string } | null;
  onNavigate?: () => void;
  siteName: string;
  tagline: string | null;
  logoUrl: string | null;
  navItems?: NavEntry[];
  subscribe: {
    enabled: boolean;
    priceText: string | null;
    href: string;
    subscribedDays?: number | null;
  };
}

/** 内置与自定义导航（含目录子项）共同参与最长前缀匹配；外链不参与。 */
export function navActiveHref(pathname: string, navItems: readonly NavEntry[]) {
  return activeHref(pathname, [
    ...NAV_ITEMS.map((item) => item.href),
    ...navLinks(navItems).filter((item) => !item.external).map((item) => item.href),
  ]);
}

/** 自定义导航链接：站内链接参与激活，外链新窗口打开并带外链标记。 */
function CustomNavLink({
  link,
  active,
  nested = false,
  onNavigate,
}: {
  link: NavLink;
  active: boolean;
  nested?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      asChild
      className={cn(
        "justify-start",
        nested && "pl-9",
        link.kind === "section" && "max-md:hidden",
        active && "bg-accent font-medium text-accent-foreground",
      )}
    >
      {link.external ? (
        <a href={link.href} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>
          {createElement(navIcon(link.icon))}
          <span className="min-w-0 flex-1 truncate">{link.label}</span>
          <ArrowUpRightIcon className="text-muted-foreground" aria-label="（外部链接）" />
        </a>
      ) : (
        <Link href={link.href} onClick={onNavigate} aria-current={active ? "page" : undefined}>
          {createElement(navIcon(link.icon))}
          <span className="min-w-0 truncate">{link.label}</span>
        </Link>
      )}
    </Button>
  );
}

/** 父级目录：本身不是链接，右侧向下箭头展开或收起子项（只有一层）。 */
function CustomNavGroup({
  group,
  current,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  current: string | null;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const panel = `nav-${group.key}`;
  const contains = group.children.some((child) => !child.external && child.href === current);
  const onlySections = group.children.every((child) => child.kind === "section");
  return (
    <div className={cn("flex flex-col gap-1", onlySections && "max-md:hidden")}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className={cn("justify-start", contains && !open && "font-medium text-accent-foreground")}
      >
        {createElement(navIcon(group.icon))}
        <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")}
        />
      </Button>
      <div id={panel} role="group" aria-label={group.label} hidden={!open} className="flex flex-col gap-1">
        {group.children.map((child) => (
          <CustomNavLink
            key={child.href}
            link={child}
            nested
            active={!child.external && current === child.href}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

/** 左栏内容：桌面常显与移动端抽屉共用一份（页面契约 2.1）。 */
export function LeftNavContent({
  siteName,
  tagline,
  logoUrl,
  navItems = [],
  subscribe,
  onNavigate,
  owner = false,
  user = null,
}: LeftNavProps) {
  const pathname = usePathname();
  const reading = useReadingShell();
  const current = navActiveHref(pathname, navItems);
  const hasSections = navLinks(navItems).some((item) => item.kind === "section");
  // 未手动切换的目录：包含当前页面时展开，其余收起。
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex items-center gap-3 px-5 pt-5 pb-3">
        <SiteLogo url={logoUrl} name={siteName} />
        <span className="min-w-0">
          <p className="truncate text-sm font-medium">{siteName}</p>
          {tagline ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {tagline}
            </p>
          ) : null}
        </span>
      </Link>
      <Separator />
      {reading?.navigation ? (
        <ChapterTree navigation={reading.navigation} onNavigate={onNavigate} />
      ) : (
        <nav
          className="flex flex-1 flex-col gap-1 overflow-y-auto p-3"
          aria-label="内容地图"
        >
          {NAV_ITEMS.map(({ href, label, Icon }) => {
            const active = current === href;
            return (
              <Button
                key={href}
                variant="ghost"
                size="sm"
                asChild
                className={cn(
                  "justify-start",
                  active && "bg-accent font-medium text-accent-foreground",
                )}
              >
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon />
                  {label}
                </Link>
              </Button>
            );
          })}
          {/* 自定义导航（后台「导航」管理），排在内置项之后；代码栏目面向电脑端 */}
          {navItems.map((entry) =>
            entry.kind === "group" ? (
              <CustomNavGroup
                key={entry.key}
                group={entry}
                current={current}
                open={toggled[entry.key] ?? entry.children.some((child) => !child.external && child.href === current)}
                onToggle={() =>
                  setToggled((previous) => ({
                    ...previous,
                    [entry.key]: !(previous[entry.key] ?? entry.children.some((child) => !child.external && child.href === current)),
                  }))
                }
                onNavigate={onNavigate}
              />
            ) : (
              <CustomNavLink
                key={entry.href}
                link={entry}
                active={!entry.external && current === entry.href}
                onNavigate={onNavigate}
              />
            ),
          )}
          {hasSections && (
            <p className="px-3 pt-2 text-xs text-muted-foreground md:hidden">
              更多栏目请在电脑上访问。
            </p>
          )}
        </nav>
      )}
      {/* 站主登录时，后台区段统一入口「网站管理」（/admin 内再分区段；工作台入口在后台首页） */}
      {owner && (
        <nav aria-label="后台区段" className="border-t p-3">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className={cn(
              "w-full justify-start",
              pathname.startsWith("/admin") &&
                "bg-accent font-medium text-accent-foreground",
            )}
          >
            <Link
              href="/admin"
              onClick={onNavigate}
              aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            >
              <LayoutDashboardIcon />
              网站管理
            </Link>
          </Button>
        </nav>
      )}
      <Separator />
      {/* 底部身份区（页面契约 2.4）：匿名 = 登录 + 订阅 pill；登录 = 邮箱入口 /me；站主保留后台入口。 */}
      <div className="flex flex-col gap-3 p-4">
        <SubscribePill
          enabled={subscribe.enabled}
          priceText={subscribe.priceText}
          href={subscribe.href}
          subscribedDays={subscribe.subscribedDays}
        />
        <div className="flex items-center gap-2">
          {user ? (
            <Link
              href="/me"
              onClick={onNavigate}
              aria-label={`我的权益（${user.email}）`}
              title={user.email}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-0.5 pr-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                {[...user.email.trim()][0]?.toUpperCase() ?? "我"}
              </span>
              <span className="truncate">会员中心</span>
            </Link>
          ) : (
            <Button asChild variant="outline" size="sm" className="h-9 flex-1 rounded-full">
              <Link href="/login" onClick={onNavigate}>
                登录
              </Link>
            </Button>
          )}
          <ThemeToggle compact />
        </div>
      </div>
    </div>
  );
}
