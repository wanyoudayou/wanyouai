"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BotIcon,
  HomeIcon,
  MenuIcon,
  UserRoundIcon,
  DownloadIcon,
} from "lucide-react";
import { NAV_ITEMS, navActiveHref } from "@/components/shell/left-nav";
import { navIcon } from "@/lib/navigation/icons";
import type { NavEntry } from "@/lib/navigation/types";
import { cn } from "@/lib/utils";

const RAIL_ITEM =
  "flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground";

function RailLink({ href, label, Icon, external, active }: {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  external: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      aria-label={external ? `${label}（外部链接）` : label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(RAIL_ITEM, active && "bg-accent text-primary")}
    >
      <Icon className="size-5" aria-hidden />
    </Link>
  );
}

export function NavigationRail({
  onDirectory,
  navItems,
}: {
  onDirectory: () => void;
  navItems: NavEntry[];
}) {
  const pathname = usePathname();
  const current = navActiveHref(pathname, navItems);
  return (
    <nav
      aria-label="快捷导航"
      className="flex h-dvh flex-col items-center gap-2 overflow-y-auto py-4"
    >
      <button
        type="button"
        onClick={onDirectory}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-card"
        aria-label="打开完整目录"
        title="完整目录"
      >
        <MenuIcon className="size-5" />
      </button>
      {NAV_ITEMS.map(({ href, label, Icon }) => (
        <RailLink key={href} href={href} label={label} Icon={Icon} external={false} active={current === href} />
      ))}
      {navItems.map((item) => {
        const Icon = navIcon(item.icon);
        if (item.kind !== "group")
          return (
            <RailLink key={item.href} href={item.href} label={item.label} Icon={Icon} external={item.external}
              active={!item.external && current === item.href} />
          );
        // 父级目录在图标栏中打开完整目录，在目录里展开子项。
        const active = item.children.some((child) => !child.external && child.href === current);
        return (
          <button
            key={item.key}
            type="button"
            onClick={onDirectory}
            aria-label={`${item.label}（在目录中展开）`}
            title={item.label}
            className={cn(RAIL_ITEM, active && "bg-accent text-primary")}
          >
            <Icon className="size-5" aria-hidden />
          </button>
        );
      })}
    </nav>
  );
}

export function MobileNavigation({
  onDirectory,
  onAvatar,
  avatarEnabled,
  loggedIn,
  panelLabel = "分身",
}: {
  onDirectory: () => void;
  onAvatar: () => void;
  avatarEnabled: boolean;
  loggedIn: boolean;
  panelLabel?: string;
}) {
  const pathname = usePathname();
  const item =
    "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground";
  return (
    <nav
      aria-label="移动主导航"
      className="opc-glass fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <Link
        href="/"
        className={cn(item, pathname === "/" && "text-primary")}
        aria-current={pathname === "/" ? "page" : undefined}
      >
        <HomeIcon className="size-5" aria-hidden />
        首页
      </Link>
      <button type="button" onClick={onDirectory} className={item}>
        <MenuIcon className="size-5" aria-hidden />
        目录
      </button>
      {avatarEnabled && (
        <button type="button" onClick={onAvatar} className={item}>
          {panelLabel === "SKILL" ? <DownloadIcon className="size-5" aria-hidden /> : <BotIcon className="size-5" aria-hidden />}
          {panelLabel}
        </button>
      )}
      <Link
        href={loggedIn ? "/me" : "/login"}
        className={cn(item, pathname.startsWith("/me") && "text-primary")}
        aria-current={pathname === "/me" || pathname.startsWith("/me/") ? "page" : undefined}
      >
        <UserRoundIcon className="size-5" aria-hidden />
        我的
      </Link>
    </nav>
  );
}
