import "server-only";

import Link from "next/link";
import { ArticleHeader } from "@/components/reading/article-header";
import { ProseReader } from "@/components/reading/prose-reader";
import { PaywallBlock, type PaywallViewer } from "@/components/reading/paywall-block";
import { ArticleFooter } from "@/components/reading/article-footer";
import { ReadingShellBridge } from "@/components/reading/reading-shell";
import { PageOutline } from "@/components/reading/page-outline";
import { ContentImage } from "@/components/reading/content-image";
import { ContentJsonLd } from "@/components/reading/content-json-ld";
import { RegistrationCallout } from "@/components/reading/registration-callout";
import { EventRegisterPanel, type RegisteredInfo } from "@/components/reading/event-register-panel";
import type { Eligibility } from "@/lib/events/eligibility";
import { DownloadButton } from "@/components/reading/download-button";
import { AudienceChips } from "@/components/cards/album-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { BookOpenIcon } from "lucide-react";
import { getSiteUrl } from "@/lib/site-url";
import { formatPrice } from "@/lib/format";
import type { SeriesReading } from "@/types/reading";
import type { SiteContext } from "@/lib/get-site-config";

export function SeriesDetail({ data, site, viewer, registration }: { data: SeriesReading; site: SiteContext; viewer: PaywallViewer; registration?: { eligibility: Eligibility; row: RegisteredInfo | null } | null }) {
  const { series, reading, navigation, event, isReadme } = data;
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const price = series.type === "event" ? event?.ticket_price ?? null : Number(series.price);
  const chapters = navigation.chapters.filter((chapter) => !chapter.readme);
  return <article className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10 lg:px-8">
    <ReadingShellBridge value={{ pathname: navigation.pathname, navigation, outline: <PageOutline markdown={reading?.markdown ?? ""} />, discussion: isReadme, articleSlug: reading?.article.slug ?? null }} />
    <ContentJsonLd offer={{ name: series.title, description: series.task, url: getSiteUrl() + navigation.pathname, skill: series.type === "skill", price, currency, unavailable: series.status === "paused" || event?.state === "ended" }} />
    {series.type === "skill" ? <DownloadButton authorized={data.canDownload} /> : null}
    {isReadme ? <header className="space-y-4">
      <h1 className="text-3xl leading-snug font-medium break-words">{series.title}</h1>
      <p className="text-base leading-relaxed text-muted-foreground">{series.task ?? reading?.article.summary}</p>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge tone="free">README 公开</StatusBadge>{series.status === "paused" ? <StatusBadge tone="paused">已停售</StatusBadge> : null}
        {series.type !== "event" ? <span className="text-sm text-muted-foreground">{price === 0 ? "免费内容" : `专辑 ${formatPrice(Number(price), currency)}`}</span> : null}
      </div>
      <AudienceChips audiences={series.audiences} />
      {reading?.article.cover_url ? <ContentImage src={reading.article.cover_url} /> : null}
      {series.tags.length ? <p className="text-sm text-muted-foreground">{series.tags.map((tag) => `#${tag}`).join(" · ")}</p> : null}
    </header> : reading ? <ArticleHeader article={reading.article} timezone={site.identity.timezone} /> : null}
    {series.type === "event" ? <>
      <RegistrationCallout event={event} timezone={site.identity.timezone} currency={currency} paused={series.status === "paused"} />
      {event && registration ? <div className="mt-3"><EventRegisterPanel seriesId={series.id} state={event.state} eligibility={registration.eligibility} registered={registration.row} loggedIn={viewer.loggedIn} /></div> : null}
    </> : null}
    {reading ? <><ProseReader markdown={reading.markdown} />{!reading.full ? <PaywallBlock article={reading.article} series={series} event={event} commerce={site.commerce} viewer={viewer} /> : null}</> : <EmptyState Icon={BookOpenIcon} title="编写中" description="内容介绍正在整理。" />}
    {isReadme ? <section className="space-y-3 border-t pt-6"><h2 className="text-lg font-medium">章节目录</h2>
      {chapters.length ? <ul className="divide-y">{chapters.map((chapter) => <li key={chapter.slug}><Link href={chapter.href} className="flex items-start justify-between gap-3 py-3 text-sm hover:text-primary"><span>{chapter.title}</span><span className="shrink-0 text-muted-foreground">{chapter.locked ? "◐ 查看预览" : "阅读全文 →"}</span></Link></li>)}</ul> : <p className="text-sm text-muted-foreground">编写中</p>}
    </section> : null}
    <ArticleFooter owner={site.ownerName} series={{ href: navigation.pathname, title: series.title }} discussion={isReadme} />
  </article>;
}
