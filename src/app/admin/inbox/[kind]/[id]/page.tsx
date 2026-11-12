import { AdminReturnLink } from "@/components/admin/return-link";
import { notFound } from "next/navigation";
import { requireOwner, numericId } from "@/lib/admin/detail";
import { getInboxData } from "@/lib/admin/inbox";
import { AdminInbox } from "@/components/admin/admin-inbox";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  await requireOwner();
  const { id, kind } = await params;
  if (kind !== "item" && kind !== "conversation") notFound();
  const data = await getInboxData(numericId(id), kind);
  return (
    <section className="mx-auto max-w-5xl space-y-6 p-6">
      <AdminReturnLink fallback="/admin/inbox">返回收件箱</AdminReturnLink>
      <h1 className="text-2xl font-semibold">留言与对话详情</h1>
      <AdminInbox data={data} />
    </section>
  );
}
