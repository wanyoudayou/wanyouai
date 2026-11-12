import "server-only";
import type { ComponentType } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LockIcon, MonitorIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/shared/callout";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement } from "@/lib/reading/access";
import { loginHref } from "@/lib/account/auth-flow";
import { getSiteConfig } from "@/lib/get-site-config";
import { getPublicNavRows } from "@/lib/navigation/public";
import { findSection, sectionPath } from "./registry";
import { decideSectionAccess } from "./access";
import type { SectionProps } from "@/sections/_sdk/types";

type RouteProps = { params: Promise<{ rest?: string[] }> };

export function sectionMetadata(name: string): Metadata {
  const section = findSection(name);
  return section ? { title: section.title, description: section.description } : {};
}

/** 薄路由入口：`src/app/lab/<name>/[[...rest]]/page.tsx` 只调用这里。 */
export async function renderSection(
  name: string,
  Root: ComponentType<SectionProps>,
  { params }: RouteProps,
) {
  const section = findSection(name);
  if (!section) notFound();
  const [{ rest = [] }, rows, reader] = await Promise.all([params, getPublicNavRows(), getReader()]);
  const row = rows.find((item) => item.kind === "section" && item.section === name) ?? null;
  const viewer = {
    loggedIn: reader.userId !== null,
    subscribed: hasEntitlement(reader, "subscription", null),
    owner: reader.owner,
  };
  const decision = decideSectionAccess({
    registered: true,
    enabled: row !== null,
    access: row?.access ?? null,
    ...viewer,
  });
  const path = [sectionPath(name), ...rest.map(encodeURIComponent)].join("/");
  if (decision.state === "missing") notFound();
  if (decision.state === "login") redirect(loginHref(path));
  if (decision.state === "subscribe") {
    const site = await getSiteConfig();
    const href = site.commerce.subscribePage ? `/p/${site.commerce.subscribePage}#pricing` : "/card#pricing";
    return (
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-12">
        <h1 className="font-display text-2xl font-semibold">{section.title}</h1>
        <Callout Icon={LockIcon} title="订阅会员可用">
          <p>此栏目面向订阅会员开放。订阅后即可使用全部会员栏目与付费内容。</p>
          <Button asChild size="sm" className="mt-3">
            <Link href={href}>查看订阅方案</Link>
          </Button>
        </Callout>
      </section>
    );
  }
  return (
    <div data-section={name} className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6 sm:px-6">
      {decision.preview && (
        <Callout title="站主预览">
          此栏目尚未在导航中启用，其他访客访问会看到 404。前往
          <Link href="/admin/navigation" className="mx-1 text-primary underline-offset-4 hover:underline">
            导航管理
          </Link>
          加入并启用。
        </Callout>
      )}
      <Callout Icon={MonitorIcon} className="md:hidden">
        此栏目为电脑端设计，建议在电脑上使用以获得完整体验。
      </Callout>
      <Root path={rest} viewer={viewer} />
    </div>
  );
}
