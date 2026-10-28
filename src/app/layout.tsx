import type { ReactNode } from "react";
import type { Metadata } from "next";

import { getSiteConfig } from "@/lib/get-site-config";
import { getSiteUrl } from "@/lib/site-url";
import { formatPrice } from "@/lib/format";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { getAdminIdentity } from "@/lib/admin/session";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getFooterPages, getNavPages } from "@/lib/custom-pages/get-page";
import { loadTurnstilePublic } from "@/lib/turnstile-config";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSiteConfig();
  const siteUrl = getSiteUrl();
  return {
    title: {
      default: site.siteName,
      template: `%s · ${site.siteName}`,
    },
    description: site.tagline ?? site.identity.oneLiner,
    ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  };
}

/** 已订阅用户剩余天数（pill「订阅会员 · 剩余 n 天」）；独立函数避开渲染期不纯调用检查。 */
async function getSubscribedDays(userId: string): Promise<number | null> {
  const client = await createSupabaseServerClient();
  const nowIso = new Date().toISOString();
  const { data: sub } = await client
    .from("entitlements")
    .select("ends_at")
    .eq("user_id", userId)
    .eq("type", "subscription")
    .is("revoked_at", null)
    .gt("ends_at", nowIso)
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!sub?.ends_at) return null;
  return Math.max(
    1,
    Math.ceil((new Date(sub.ends_at).getTime() - Date.now()) / 86400000),
  );
}

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const [site, owner, user, navPages, footerPages, turnstile] = await Promise.all([
    getSiteConfig(),
    getAdminIdentity()
      .then((identity) => identity.owner)
      .catch(() => false),
    getUserIdentity()
      .then((identity) => identity.user)
      .catch(() => null),
    getNavPages().catch(() => []),
    getFooterPages().catch(() => []),
    createSupabaseServerClient().then(client => loadTurnstilePublic(client)).catch(() => null),
  ]);
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  // 订阅 pill 落点：配置了自定义页 → /p/{slug}#pricing（占位符自带锚点）；否则名片页；名片卡关闭时退化为 /card
  const configuredPage = site.commerce.subscribePage;
  const subscribeHref = configuredPage
    ? `/p/${configuredPage}#pricing`
    : navPages.some((page) => page.href === "/p/pricing")
      ? "/p/pricing#pricing"
      : site.identity.showSubscriptionCard
        ? "/card#pricing"
        : "/card";
  const subscribePriceText = site.commerce.subscriptionPrice
    ? `${formatPrice(site.commerce.subscriptionPrice.amount, currency)} / 年`
    : null;
  const subscribedDays = user ? await getSubscribedDays(user.id) : null;
  const contactHref =
    site.contact.bookingUrl ??
    (site.contact.email ? `mailto:${site.contact.email}` : null);
  const contactLabel = site.contact.bookingUrl
    ? "预约"
    : site.contact.email
      ? "联系站主"
      : null;

  // Translation extensions can decorate <html> before hydration; child mismatches remain visible.
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell
            owner={owner}
            user={user}
            site={{
              name: site.siteName,
              tagline: site.tagline,
              logoUrl: site.identity.logoUrl,
            }}
            navPages={navPages}
            subscribe={{
              enabled: site.commerce.paymentEnabled,
              priceText: subscribePriceText,
              href: subscribeHref,
              subscribedDays,
            }}
            avatarModel={site.avatar.model}
            avatarEnabled={site.avatar.enabled}
            avatarAnonymous={site.avatar.anonymousEntry}
            turnstileSiteKey={turnstile?.enabled ? turnstile.siteKey : null}
            footer={{
              siteName: site.siteName,
              credit: site.footerCredit,
              refundPolicyUrl: site.commerce.refundPolicyUrl,
              contactHref,
              contactLabel,
              pages: footerPages,
            }}
          >
            {children}
          </AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
