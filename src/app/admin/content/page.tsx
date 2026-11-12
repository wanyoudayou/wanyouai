import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { readRelatedPages } from "@/lib/admin/related-pages";
import { adminReturn } from "@/lib/admin/detail";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reviewRevision } from "@/lib/importing/server";
import { createPublisherStore } from "@/lib/publishing/server";
import { ContentWorkbench } from "@/components/admin/content-workbench";
export const metadata: Metadata = {
  title: "内容工作台",
  robots: { index: false, follow: false },
};
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    revision?: string;
    article?: string;
    series?: string;
    returnTo?: string;
  }>;
}) {
  const params = await searchParams;
  const initialType = params.type === "chapter" ? "chapter" : params.type === "skill" ? "skill" : "blog";
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  const client = await createSupabaseServerClient();
  const { data } = await readRelatedPages((from, to) =>
    client
      .from("series")
      .select("id,slug,title,type")
      .neq("status", "archived")
      .order("title")
      .order("id")
      .range(from, to),
  );
  const revision =
    params.revision && /^\d+$/.test(params.revision)
      ? await reviewRevision(Number(params.revision))
      : null;
  // 编辑既有内容（后台列表「编辑内容」入口）：装载文章元数据与正文进工作台，保存走统一发布管线（相同 slug 更新原文）
  let articleDraft;
  if (!revision && params.article && /^\d+$/.test(params.article)) {
    const { data: article, error: articleError } = await client
      .from("articles")
      .select(
        "id,slug,title,type,access,price,summary,cover_url,tags,series_id",
      )
      .eq("id", Number(params.article))
      .maybeSingle();
    if (articleError) throw new Error("文章暂时无法读取，请稍后重试");
    if (!article) notFound();
    if (article) {
      const { data: body, error: bodyError } = await client
        .from("article_bodies")
        .select("content")
        .eq("article_id", article.id)
        .maybeSingle();
      if (bodyError || !body)
        throw new Error("正文暂时无法读取，未加载空白草稿");
      const seriesSlug = article.series_id
        ? (data ?? []).find((s) => s.id === article.series_id)?.slug
        : undefined;
      articleDraft = {
        id: 0,
        path: `${article.slug}.md`,
        frontmatter: {
          title: article.title,
          slug: article.slug,
          type: article.type,
          access: article.access,
          ...(seriesSlug ? { series_slug: seriesSlug } : {}),
          ...(article.summary ? { summary: article.summary } : {}),
          ...(article.cover_url ? { cover: article.cover_url } : {}),
          ...(article.price !== null && article.price !== undefined
            ? { price: Number(article.price) }
            : {}),
          ...(article.tags?.length ? { tags: article.tags } : {}),
        },
        markdown: body?.content ?? "",
        media: [],
        attachments: [],
      };
    }
  }
  const initialDraft = revision
    ? {
        id: revision.id,
        path: revision.path,
        ...revision.snapshot,
        attachments: revision.snapshot.media.map((m) => ({
          name: m.source_path,
          url: createPublisherStore().media.publicUrl(m.storage_path),
          width: m.width,
          height: m.height,
        })),
      }
    : articleDraft;
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10 lg:px-8">
      <Link
        href={adminReturn(params.returnTo, "/admin/articles")}
        className="text-sm text-muted-foreground underline"
      >
        返回后台
      </Link>
      <h1 className="text-2xl font-medium">内容工作台</h1>
      <p className="text-sm leading-6 text-muted-foreground">
        新建草稿或导入 Markdown
        文件，保存待发布修订，检查匿名预览后确认发布。相同文章地址更新原文章。
      </p>
      <ContentWorkbench
        initialDraft={initialDraft}
        initialType={initialType}
        initialSeries={
          data?.some((s) => s.slug === params.series)
            ? params.series
            : undefined
        }
        series={data ?? []}
      />
    </div>
  );
}
