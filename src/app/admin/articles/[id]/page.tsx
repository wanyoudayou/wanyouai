import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner, numericId, adminReturn } from "@/lib/admin/detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ContentControls } from "@/components/admin/content-controls";
import { AdminDataTable } from "@/components/admin/admin-data-table";
import {
  parseListQuery,
  lastPage,
  type RawListQuery,
} from "@/lib/admin/list-query";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawListQuery>;
}) {
  await requireOwner();
  const id = numericId((await params).id);
  const raw = await searchParams;
  const query = parseListQuery(raw);
  const client = await createSupabaseServerClient();
  const { data: a, error } = await client
    .from("articles")
    .select(
      "id,slug,title,status,access,type,updated_at,paused_at,price,featured",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("文章暂时不可用");
  if (!a) notFound();
  const base = () =>
    client
      .from("article_versions")
      .select("version,created_at", { count: "exact" })
      .eq("article_id", id)
      .order("version", { ascending: false });
  let result = await base().range(
    (query.page - 1) * query.pageSize,
    query.page * query.pageSize - 1,
  );
  if (result.error || result.count === null) throw new Error("版本暂时不可用");
  const page = Math.min(query.page, lastPage(result.count, query.pageSize));
  if (page !== query.page) {
    query.page = page;
    result = await base().range(
      (page - 1) * query.pageSize,
      page * query.pageSize - 1,
    );
  }
  if (result.error || result.count === null) throw new Error("版本暂时不可用");
  const { data: versions, count } = result;
  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <Link
        href={adminReturn(raw.returnTo, "/admin/articles")}
        className="text-sm text-primary"
      >
        返回文章列表
      </Link>
      <h1 className="text-2xl font-semibold">{a.title}</h1>
      <div className="rounded-xl border bg-card p-5">
        <ContentControls
          kind="article"
          item={a}
          now={new Date().toISOString()}
          versions={versions ?? []}
        />
      </div>
      <h2 className="text-lg font-medium">版本历史</h2>
      <AdminDataTable
        rows={(versions ?? []).map((v) => ({
          key: String(v.version),
          title: `版本 ${v.version}`,
          href: `/admin/articles/${id}?page=${query.page}`,
          cells: { created: new Date(v.created_at).toISOString() },
        }))}
        columns={[{ key: "created", label: "创建时间（UTC）" }]}
        total={count}
        query={query}
        searchable={false}
        sorts={["newest"]}
      />
    </section>
  );
}
