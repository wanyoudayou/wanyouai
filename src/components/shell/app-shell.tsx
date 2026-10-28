"use client";

import { usePathname } from "next/navigation";
import {
  AdminPanelProvider,
  AdminWorkspaceGrid,
} from "@/components/admin/admin-panel";
import { useEffect, useState } from "react";
import Link from "next/link";
import { MenuIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { LeftNavContent } from "@/components/shell/left-nav";
import {
  MobileNavigation,
  NavigationRail,
} from "@/components/shell/responsive-navigation";
import { AdminNavigation } from "@/components/admin/admin-navigation";
import {
  RightPanelProvider,
  RightPanelSurfaces,
  useRightPanelCollapse,
  isAvatarPage,
} from "@/components/shell/right-panel";
import { ReadingShellProvider, useReadingShell } from "@/components/reading/reading-shell";
import { SiteFooter } from "@/components/shell/site-footer";
import { cn } from "@/lib/utils";

/**
 * 全站统一三栏骨架（页面契约 §2 / Design Tokens §4）：
 *   ≥1280  三栏全开（240 / 1fr / 360）
 *   1024–1280 右栏收 48px 窄条（右缘按钮滑出）
 *   <1024  左栏汉堡抽屉 + 右栏底部抽屉
 *  children 保持服务端渲染；本组件只负责骨架与交互槽位。
 */

export interface AppShellProps {
  owner?: boolean;
  user?: { email: string } | null;
  site: { name: string; tagline: string | null; logoUrl: string | null };
  navPages?: { href: string; label: string }[];
  subscribe: {
    enabled: boolean;
    priceText: string | null;
    href: string;
    subscribedDays?: number | null;
  };
  avatarModel: string | null;
  avatarEnabled: boolean;
  avatarAnonymous: boolean;
  turnstileSiteKey: string | null;
  footer: {
    siteName: string;
    credit: boolean;
    refundPolicyUrl: string | null;
    contactHref: string | null;
    contactLabel: string | null;
    pages?: { href: string; label: string }[];
  };
  children: React.ReactNode;
}

export function AppShell({
  site,
  subscribe,
  avatarModel,
  avatarEnabled,
  avatarAnonymous,
  turnstileSiteKey,
  footer,
  children,
  owner = false,
  user = null,
  navPages = [],
}: AppShellProps) {
  const pathname = usePathname();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  const bare = pathname === "/login";
  const showAvatar = avatarEnabled && !/^\/skills\/[^/]+\/chat\/?$/.test(pathname);
  const navProps = {
    siteName: site.name,
    tagline: site.tagline,
    logoUrl: site.logoUrl,
    subscribe,
    owner,
    user,
    navPages,
  };
  if (bare)
    return (
      <main className="flex min-h-dvh flex-col">
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        <SiteFooter {...footer} />
      </main>
    );

  return (
    <AdminPanelProvider key={pathname}>
      <RightPanelProvider
        avatarModel={avatarModel}
        avatarEnabled={showAvatar}
        avatarAnonymous={avatarAnonymous}
        turnstileSiteKey={turnstileSiteKey}
        loggedIn={!!user}
      >
        <ReadingShellProvider>
          <ShellLayout
            admin={admin}
            avatarEnabled={showAvatar}
            navProps={navProps}
            footer={footer}
          >
            {children}
          </ShellLayout>
        </ReadingShellProvider>
      </RightPanelProvider>
    </AdminPanelProvider>
  );
}

/** 三栏骨架本体：右栏折叠状态决定 ≥1280 的第三列宽度（须位于 RightPanelProvider 内）。 */
function ShellLayout({
  admin,
  avatarEnabled,
  navProps,
  footer,
  children,
}: {
  admin: boolean;
  avatarEnabled: boolean;
  navProps: Omit<Parameters<typeof LeftNavContent>[0], "onNavigate">;
  footer: AppShellProps["footer"];
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const close = () => setNavOpen(false);
    window.addEventListener("wanyou:open-reading-panel", close);
    return () => window.removeEventListener("wanyou:open-reading-panel", close);
  }, []);
  const openDirectory = () => {
    window.dispatchEvent(new Event("wanyou:open-navigation"));
    setNavOpen(true);
  };
  const { collapsed } = useRightPanelCollapse();
  const pathname = usePathname();
  const skillPanel = useReadingShell()?.skillPanel;
  // 右栏只在分身页面且未折叠时占第三列（xl）；折叠与非分身页面均为两列
  const panelAvailable = !!skillPanel || avatarEnabled;
  const panelOpen = !admin && panelAvailable && isAvatarPage(pathname) && (!!skillPanel || !collapsed);
  const Grid = admin ? AdminWorkspaceGrid : "div";
  const siteName = navProps.siteName;

  return (
    <Grid
      {...(!admin
        ? {
            className: cn(
              "min-h-dvh pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:grid md:grid-cols-[4.5rem_minmax(0,1fr)] md:pb-0 xl:grid-cols-[236px_minmax(0,1fr)]",
              panelOpen && "xl:grid-cols-[236px_minmax(0,1fr)_300px]",
            ),
          }
        : {})}
    >
      {/* 左栏（≥1024 常显） */}
      <aside
        className={cn(
          "opc-glass hidden min-h-0 border-r",
          admin ? "lg:block" : "xl:block",
        )}
      >
        <div className="sticky top-0 h-dvh">
          {admin && navProps.owner ? (
            <AdminNavigation />
          ) : (
            <LeftNavContent {...navProps} />
          )}
        </div>
      </aside>
      {!admin && (
        <aside className="opc-glass hidden border-r md:block xl:hidden">
          <div className="sticky top-0">
            <NavigationRail
              onDirectory={openDirectory}
              navPages={navProps.navPages ?? []}
            />
          </div>
        </aside>
      )}

      {/* 中栏：顶栏（<1024）+ 主体 + footer */}
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header
          className={cn(
            "opc-glass sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3",
            admin ? "lg:hidden" : "xl:hidden",
          )}
        >
          <Sheet
            open={navOpen}
            onOpenChange={(open) => {
              if (open) openDirectory();
              else setNavOpen(false);
            }}
          >
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="打开内容地图">
                <MenuIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>内容地图</SheetTitle>
              </SheetHeader>
              {admin && navProps.owner ? (
                <AdminNavigation onNavigate={() => setNavOpen(false)} />
              ) : (
                <LeftNavContent
                  {...navProps}
                  onNavigate={() => setNavOpen(false)}
                />
              )}
            </SheetContent>
          </Sheet>
          <Link href="/" className="text-sm font-medium">
            {siteName}
          </Link>
        </header>

        <main className="min-w-0 flex-1">{children}</main>

        <SiteFooter {...footer} />
      </div>

      {/* 右栏：常显面板 / 窄条 / 移动悬浮按钮（内部按断点自渲染） */}
      {!admin && (
        <>
          <RightPanelSurfaces key={pathname} />
          <MobileNavigation
            onDirectory={openDirectory}
            onAvatar={() =>
              window.dispatchEvent(new Event("wanyou:open-reading-panel"))
            }
            avatarEnabled={panelAvailable}
            panelLabel={skillPanel ? "SKILL" : "分身"}
            loggedIn={!!navProps.user}
          />
        </>
      )}
    </Grid>
  );
}
