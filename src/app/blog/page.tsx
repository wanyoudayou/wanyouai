import { publicMetadata } from "@/lib/seo/server";

import { getBlogArticles } from "@/lib/get-articles";
import { getSiteConfig } from "@/lib/get-site-config";
import { ListBrowser } from "@/components/list/list-browser";
import { PanelPlaceholder } from "@/components/shell/panel-placeholder";

export async function generateMetadata() {
  return publicMetadata("博客", "/blog");
}

const TIPS = {
  title: "可以这样读博客",
  items: [
    "付费单篇购买后永久可读",
    "订阅解锁全站付费内容与专属内容",
    "在线订阅与购买尚未开放",
  ],
};

/** /blog 博客列表（页面契约 3.2）。 */
export default async function BlogPage() {
  const site = await getSiteConfig();
  const items = await getBlogArticles();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
      <PanelPlaceholder value={{ kind: "tips", ...TIPS }} />
      <div className="flex flex-col gap-8">
        <h1 className="text-2xl leading-snug font-medium">博客</h1>
        <ListBrowser
          variant="blog"
          items={items}
          timezone={site.identity.timezone}
          searchPlaceholder="搜索文章…"
          empty={{ title: "还没有公开文章" }}
        />
      </div>
    </div>
  );
}
