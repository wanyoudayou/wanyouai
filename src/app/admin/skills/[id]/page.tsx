import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { getAdminSkill } from "@/lib/skills/repository";
import { skillReleases, readSkillRelease } from "@/lib/skills/storage";
import { SkillManager } from "@/components/admin/skill-manager";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminIdentity()).owner) redirect("/admin");
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  const item = await getAdminSkill(id); if (!item) notFound();
  return <section className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6"><Link className="text-sm text-primary" href="/admin/skills">返回 SKILL 列表</Link><h1 className="text-2xl font-semibold">{item.article.title}</h1>
    <div className="flex gap-4 text-sm text-primary"><Link href={`/admin/content?article=${id}&returnTo=/admin/skills/${id}`}>编辑公开介绍</Link><Link href={`/skills/${item.article.slug}`}>查看前台</Link><Link href={`/admin/articles/${id}`}>发布状态</Link></div>
    <SkillManager initial={item.settings} initialReleases={await skillReleases(id)} currentRelease={item.settings.current_release ? await readSkillRelease(item.settings.current_release) : null} />
  </section>;
}
