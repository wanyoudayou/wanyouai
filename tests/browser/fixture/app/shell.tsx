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
      navItems={[
        { href: "/p/pricing", label: "收费方案", icon: "credit-card", kind: "page", external: false },
        { href: "/collections/example", label: "使用指南", icon: "book-open", kind: "series", external: false },
        { href: "/lab/fixture-lab", label: "实验栏目", icon: "flask", kind: "section", external: false },
        { href: "https://example.com/tools", label: "外部工具", icon: "external-link", kind: "external", external: true },
        {
          kind: "group",
          key: "group-fixture",
          label: "学习资源",
          icon: "folder",
          children: [
            { href: "/p/design-preview", label: "设计预览", icon: "file-text", kind: "page", external: false },
            { href: "https://example.com/docs", label: "开发文档", icon: "external-link", kind: "external", external: true },
          ],
        },
      ]}
      subscribe={{ enabled: pathname === "/hero-layout", priceText: "¥99 / 年", href: "/p/pricing" }}
      homeChat
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
