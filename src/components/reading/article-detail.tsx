import "server-only";

import Link from "next/link";
import { ArticleHeader } from "@/components/reading/article-header";
import { ProseReader } from "@/components/reading/prose-reader";
import { PaywallBlock, type PaywallViewer } from "@/components/reading/paywall-block";
import { ArticleFooter } from "@/components/reading/article-footer";
import { ReadingShellBridge } from "@/components/reading/reading-shell";
import { PageOutline } from "@/components/reading/page-outline";
import { ContentJsonLd } from "@/components/reading/content-json-ld";
import { getSiteUrl } from "@/lib/site-url";
import type { ArticleReading } from "@/types/reading";
import type { SiteContext } from "@/lib/get-site-config";

export function ArticleDetail({ reading, site, viewer }: { reading: ArticleReading; site: SiteContext; viewer: PaywallViewer }) {
  const { article } = reading;
  const pathname = `/blog/${encodeURIComponent(article.slug)}`;
  return <article className="mx-auto w-full max-w-3xl space-y-8 px-6 py-10 lg:px-8">
    <ReadingShellBridge value={{ pathname, navigation: null, outline: <PageOutline markdown={reading.markdown} />, discussion: true, articleSlug: article.slug }} />
    {article.access === "paid" ? <ContentJsonLd offer={{ name: article.title, description: article.summary, url: getSiteUrl() + pathname, skill: false, price: article.price, currency: site.commerce.subscriptionPrice?.currency ?? "CNY", unavailable: article.status === "paused" }} /> : null}
    <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground">← 返回博客</Link>
    <ArticleHeader article={article} timezone={site.identity.timezone} />
    <ProseReader markdown={reading.markdown} />
    {!reading.full ? <PaywallBlock article={article} commerce={site.commerce} viewer={viewer} /> : null}
    <ArticleFooter owner={site.ownerName} />
  </article>;
}
