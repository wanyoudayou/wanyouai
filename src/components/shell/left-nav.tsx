"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenIcon,
  FileTextIcon,
  BriefcaseIcon,
  CalendarDaysIcon,
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
  navPages?: { href: string; label: string }[];
  subscribe: {
    enabled: boolean;
    priceText: string | null;
    href: string;
    subscribedDays?: number | null;
  };
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 左栏内容：桌面常显与移动端抽屉共用一份（页面契约 2.1）。 */
export function LeftNavContent({
  siteName,
  tagline,
  logoUrl,
  navPages = [],
  subscribe,
  onNavigate,
  owner = false,
  user = null,
}: LeftNavProps) {
  const pathname = usePathname();
  const reading = useReadingShell();

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
            const active = isActive(pathname, href);
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
          {/* 自定义页（published + 配了导航名），排在内置项之后 */}
          {navPages.map(({ href, label }) => {
            const active = isActive(pathname, href);
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
                  <FileTextIcon />
                  {label}
                </Link>
              </Button>
            );
          })}
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
        <ThemeToggle />
        <SubscribePill
          enabled={subscribe.enabled}
          priceText={subscribe.priceText}
          href={subscribe.href}
          subscribedDays={subscribe.subscribedDays}
        />
        {user ? (
          <Link
            href="/me"
            onClick={onNavigate}
            aria-label={`我的权益（${user.email}）`}
            title={user.email}
            className="flex items-center gap-2 self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground"
          >
            <span className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
              {[...user.email.trim()][0]?.toUpperCase() ?? "我"}
            </span>
            会员中心
          </Link>
        ) : (
          <Link
            href="/login"
            onClick={onNavigate}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            登录
          </Link>
        )}
      </div>
    </div>
  );
}
