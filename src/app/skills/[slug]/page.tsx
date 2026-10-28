import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeries, getSeriesSeo } from "@/lib/get-series";
import { getSiteConfig } from "@/lib/get-site-config";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement } from "@/lib/reading/access";
import { SeriesDetail } from "@/components/reading/series-detail";
import Link from "next/link";
import { getSkill } from "@/lib/skills/repository";
import { canUseSkill } from "@/lib/skills/access";
import { readSkillRelease } from "@/lib/skills/storage";
import { SkillDelivery } from "@/components/reading/skill-delivery";
import { MarkdownContent } from "@/components/reading/markdown-content";
import { PurchaseButton } from "@/components/reading/purchase-button";
import { publicMetadata } from "@/lib/seo/server";
import { legacySkillChapters } from "@/lib/skills/legacy";
import { ReadingShellBridge } from "@/components/reading/reading-shell";
import { uuid } from "@/lib/skills/types";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ article?: string | string[]; panel?: string; session?: string }>;
}
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const skill = await getSkill((await params).slug);
  if (skill && !(await searchParams).article) return publicMetadata(skill.article.title, `/skills/${skill.article.slug}`, skill.article.summary, skill.article.cover_url);
  return getSeriesSeo(
    "skill",
    (await params).slug,
    (await searchParams).article,
  );
}
export default async function DetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { article, panel, session } = await searchParams;
  if (Array.isArray(article)) notFound();
  const skill = !article ? await getSkill(slug) : null;
  if (skill) {
    const [reader, site] = await Promise.all([getReader(), getSiteConfig()]);
    const allowed = await canUseSkill(skill.article.id, reader.userId);
    const release = allowed && skill.settings.current_release ? await readSkillRelease(skill.settings.current_release) : null;
    const chapters = skill.settings.legacy_series_id ? await legacySkillChapters(skill.settings.legacy_series_id) : [];
    const delivery = <section className="min-w-0 space-y-4"><p className="whitespace-pre-wrap text-sm">{skill.settings.usage_guide || "下载后在支持 Agent Skills 的工具中安装。网站不会执行包内脚本。"}</p>
        {!skill.settings.current_release ? <p className="text-sm text-muted-foreground">版本包准备中，暂未开放购买和下载。</p> : !reader.userId ? <Link href={`/login?next=${encodeURIComponent(`/skills/${slug}`)}`} className="text-primary">登录后{skill.settings.price > 0 ? "购买或使用" : "免费使用"}</Link> : allowed && release ? <>
          <SkillDelivery release={release.id} version={release.version} />
          <details className="text-sm"><summary>此版本更新说明与文件清单</summary><p className="my-3 whitespace-pre-wrap">{release.notes}</p><ul>{release.manifest.map(f => <li key={f.path} className="break-all">{f.path} · {f.size} 字节</li>)}</ul></details>
        </> : skill.article.status === "published" ? <PurchaseButton skuType="skill" targetId={skill.article.id} label={`购买 · ¥${Number(skill.settings.price).toFixed(2)}`} enabled={site.commerce.paymentEnabled} /> : <p className="text-sm">此 Skill 已停售；已有有效权益的账户仍可使用。</p>}
      </section>;
    return <article className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <ReadingShellBridge value={{ pathname: `/skills/${slug}`, navigation: null, outline: null, discussion: false, skillPanel: {
        content: delivery,
        initialMode: skill.settings.online_enabled && panel === "online" ? "online" : "download",
        ...(skill.settings.online_enabled ? allowed ? { chat: { skill: skill.article.id, title: skill.article.title, guide: skill.settings.usage_guide, initialSession: uuid(session) ? session : undefined } } : { online: <div className="space-y-4"><p className="text-sm">{reader.userId ? "购买此 Skill 或取得有效订阅后，即可在线测试。" : "登录后即可确认此 Skill 的使用权限。"}</p>{delivery}</div> } : {}),
      } }} />
      <Link href="/skills" className="text-sm text-primary">所有 SKILL</Link><header className="space-y-3"><h1 className="text-3xl font-semibold">{skill.article.title}</h1><p className="text-muted-foreground">{skill.article.summary}</p></header>
      <MarkdownContent markdown={skill.markdown} />
      {chapters.length > 0 && <section className="space-y-3"><h2 className="text-lg font-semibold">原有章节与资料</h2><p className="text-sm text-muted-foreground">保留原有阅读权限；已购买此技能的账户可继续阅读。</p><ul className="space-y-2">{chapters.map(c => <li key={c.href}><Link className="text-primary underline" href={c.href}>{c.title}</Link></li>)}</ul></section>}
    </article>;
  }
  const [data, site, reader] = await Promise.all([
    getSeries("skill", slug, article),
    getSiteConfig(),
    getReader(),
  ]);
  const viewer = {
    loggedIn: reader.userId !== null,
    subscribed: hasEntitlement(reader, "subscription", null),
  };
  if (!data) notFound();
  return <SeriesDetail data={data} site={site} viewer={viewer} />;
}
