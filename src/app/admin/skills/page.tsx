import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { getAdminResourcePage } from "@/lib/admin/list-resources";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import { ADMIN_LABELS } from "@/lib/admin/list-labels";
import type { RawListQuery } from "@/lib/admin/list-query";
export default async function Page({ searchParams }: { searchParams: Promise<RawListQuery> }) {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  const data = await getAdminResourcePage("articles", { ...await searchParams, type: "skill", series: undefined });
  return <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6"><header><h1 className="text-2xl font-semibold">SKILL</h1><p className="mt-2 text-sm text-muted-foreground">先编写公开介绍，再管理私有版本包、收费与在线使用。</p></header>
    <AdminDataTable query={data.query} total={data.filteredTotal} statuses={["draft", "published", "paused", "archived", "unpublished", "pending-review"]} columns={[{ key: "status", label: "状态" }]} create={{ label: "新建 Skill 介绍", href: "/admin/content?type=skill&returnTo=/admin/skills" }}
      rows={data.items.map(a => {
        const editor = a.article_id ? `/admin/content?article=${a.article_id}&returnTo=/admin/skills` : `/admin/content?revision=${a.pending_revision_id}&returnTo=/admin/skills`;
        return { key: String(a.document_key), title: String(a.title), description: `${a.slug}${a.pending_revision_id ? ` · 待审核 v${a.pending_version}` : ""}`, href: a.article_id ? `/admin/skills/${a.article_id}` : editor,
          cells: { status: a.status ? ADMIN_LABELS[String(a.status)] ?? String(a.status) : "未发布" }, actions: [{ label: "编辑介绍", href: editor }, ...(a.article_id ? [{ label: "管理版本", href: `/admin/skills/${a.article_id}` }] : [])] };
      })} />
  </section>;
}
