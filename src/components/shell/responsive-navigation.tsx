"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BotIcon,
  HomeIcon,
  MenuIcon,
  UserRoundIcon,
  FileTextIcon,
  DownloadIcon,
} from "lucide-react";
import { NAV_ITEMS } from "@/components/shell/left-nav";
import { cn } from "@/lib/utils";

export function NavigationRail({
  onDirectory,
  navPages,
}: {
  onDirectory: () => void;
  navPages: { href: string; label: string }[];
}) {
  const pathname = usePathname();
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
      {[
        ...NAV_ITEMS,
        ...navPages.map((item) => ({ ...item, Icon: FileTextIcon })),
      ].map(({ href, label, Icon }) => {
        const active =
          href === "/"
            ? pathname === "/"
            : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground",
              active && "bg-accent text-primary",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </Link>
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
      >
        <UserRoundIcon className="size-5" aria-hidden />
        我的
      </Link>
    </nav>
  );
}
