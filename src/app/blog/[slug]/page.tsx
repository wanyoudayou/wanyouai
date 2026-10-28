import { publicMetadata } from "@/lib/seo/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBlogArticle, getBlogMetadata } from "@/lib/get-article";
import { getSiteConfig } from "@/lib/get-site-config";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement } from "@/lib/reading/access";
import { ArticleDetail } from "@/components/reading/article-detail";

interface Props {
  params: Promise<{ slug: string }>;
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getBlogMetadata((await params).slug);
  return article
    ? publicMetadata(
        article.title,
        `/blog/${encodeURIComponent(article.slug)}`,
        article.summary,
        article.cover_url,
      )
    : { title: "文章不存在", robots: { index: false, follow: false } };
}
export default async function BlogArticlePage({ params }: Props) {
  const [reading, site, reader] = await Promise.all([
    getBlogArticle((await params).slug),
    getSiteConfig(),
    getReader(),
  ]);
  const viewer = {
    loggedIn: reader.userId !== null,
    subscribed: hasEntitlement(reader, "subscription", null),
  };
  if (!reading) notFound();
  return <ArticleDetail reading={reading} site={site} viewer={viewer} />;
}
