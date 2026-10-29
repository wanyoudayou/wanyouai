"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
export function FixtureShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const admin = pathname.startsWith("/admin");
  const anonymousAi = pathname === "/blog/anonymous-ai";
  const memberAi = pathname === "/blog/member-ai";
  return (
    <AppShell
      site={{ name: "示例工作室", tagline: "内容、服务与合作", logoUrl: null }}
      owner={admin}
      user={admin || memberAi ? { email: "fixture@example.test" } : null}
      navPages={[
        { href: "/p/pricing", label: "收费方案" },
        { href: "/collections/example", label: "使用指南" },
      ]}
      subscribe={{ enabled: false, priceText: "¥99 / 年", href: "/p/pricing" }}
      avatarModel={null}
      avatarEnabled
      avatarAnonymous={anonymousAi || memberAi}
      turnstileSiteKey={anonymousAi || memberAi ? "synthetic-site-key-a" : null}
      footer={{
        siteName: "示例工作室",
        credit: false,
        refundPolicyUrl: null,
        contactHref: null,
        contactLabel: null,
      }}
    >
      {children}
    </AppShell>
  );
}
