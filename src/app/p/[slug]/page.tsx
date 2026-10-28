import { publicMetadata } from "@/lib/seo/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCustomPage } from "@/lib/custom-pages/get-page";
import { CustomHtmlWithWidgets } from "@/components/custom/custom-html-widgets";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = await getCustomPage((await params).slug);
  if (!page)
    return { title: "页面不存在", robots: { index: false, follow: false } };
  return publicMetadata(
    page.title,
    `/p/${encodeURIComponent(page.slug)}`,
    page.description,
  );
}

/** 自定义页（/p/[slug]）：站主自建的富样式页面，一律公开；草稿/归档即 404。 */
export default async function CustomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const page = await getCustomPage((await params).slug);
  if (!page) notFound();
  return (
    <article
      className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8"
      aria-label={page.title}
    >
      <CustomHtmlWithWidgets html={page.html} />
    </article>
  );
}
