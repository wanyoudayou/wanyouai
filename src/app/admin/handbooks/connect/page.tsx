import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { HandbookConnections } from "@/components/admin/handbook-connections";
export default async function Page() {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  return <section className="mx-auto max-w-3xl space-y-6 px-6 py-8"><h1 className="text-2xl font-semibold">Obsidian 手册连接</h1><p className="text-sm text-muted-foreground">为每个笔记库创建独立凭据，需要时单独撤销。插件只上传选定手册和其引用图片，正文仍经过网站的发布校验。</p><HandbookConnections /></section>;
}
