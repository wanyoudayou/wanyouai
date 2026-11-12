import { publicMetadata } from "@/lib/seo/server";

import { unmappedLegacySkills } from "@/lib/skills/legacy";
import Link from "next/link";
import { listSkills } from "@/lib/skills/repository";
import type { RawListQuery } from "@/lib/admin/list-query";
import { listQueryString } from "@/lib/admin/list-query";

export async function generateMetadata() {
  return publicMetadata("技能", "/skills");
}

export default async function SkillsPage({ searchParams }: { searchParams: Promise<RawListQuery> }) {
  const data = await listSkills(await searchParams);
  const legacy = await unmappedLegacySkills();
  return <><section className="mx-auto max-w-5xl space-y-6 px-6 py-10"><header><h1 className="text-3xl font-semibold">SKILL</h1><p className="mt-3 text-muted-foreground">可下载的技能包，以及站主启用的在线文本能力。</p></header>
    <form><label className="sr-only" htmlFor="skill-search">搜索 Skill</label><input id="skill-search" name="q" defaultValue={data.query.q} className="w-full rounded-md border bg-background p-3" placeholder="搜索 Skill，按回车提交" /></form>
    <div className="grid gap-4 sm:grid-cols-2">{data.items.map(item => <Link key={item.id} href={`/skills/${item.slug}`} className="surface-card space-y-3 rounded-xl border p-5 transition-colors hover:border-primary"><h2 className="text-lg font-semibold">{item.title}</h2><p className="text-sm text-muted-foreground">{item.summary}</p></Link>)}</div>
    {!data.total && <p className="text-sm text-muted-foreground">暂无独立 Skill。</p>}
    <nav aria-label="Skill 分页" className="flex gap-5 text-sm text-primary">{data.query.page > 1 && <Link href={listQueryString(data.query, { page: data.query.page - 1 })}>上一页</Link>}{data.query.page * data.query.pageSize < data.total && <Link href={listQueryString(data.query, { page: data.query.page + 1 })}>下一页</Link>}</nav>
    {legacy.length > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold">原有技能资料</h2><ul className="space-y-2">{legacy.map(item => <li key={item.slug}><Link className="text-primary underline" href={`/skills/${item.slug}`}>{item.title}</Link></li>)}</ul></section>}
  </section></>;
}
