import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeries, getSeriesSeo } from "@/lib/get-series";
import { getSiteConfig } from "@/lib/get-site-config";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement } from "@/lib/reading/access";
import { SeriesDetail } from "@/components/reading/series-detail";
import { getSkill } from "@/lib/skills/repository";
import { canUseSkill } from "@/lib/skills/access";
import { readSkillRelease } from "@/lib/skills/storage";
import { publicMetadata } from "@/lib/seo/server";
import { legacySkillChapters } from "@/lib/skills/legacy";
import { ReadingShellBridge } from "@/components/reading/reading-shell";
import { SkillDeliverySection, SkillDetail } from "@/components/reading/skill-detail";
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
    const delivery = <SkillDeliverySection slug={slug} usageGuide={skill.settings.usage_guide} hasRelease={!!skill.settings.current_release}
      loggedIn={!!reader.userId} allowed={allowed} release={release} published={skill.article.status === "published"}
      price={Number(skill.settings.price)} currency={site.commerce.subscriptionPrice?.currency ?? "CNY"}
      paymentEnabled={site.commerce.paymentEnabled} skillId={skill.article.id} />;
    return <article className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <ReadingShellBridge value={{ pathname: `/skills/${slug}`, navigation: null, outline: null, discussion: false, skillPanel: {
        content: delivery,
        initialMode: skill.settings.online_enabled && panel === "online" ? "online" : "download",
        ...(skill.settings.online_enabled ? allowed ? { chat: { skill: skill.article.id, title: skill.article.title, guide: skill.settings.usage_guide, initialSession: uuid(session) ? session : undefined } } : { online: <div className="space-y-4"><p className="text-sm">{reader.userId ? "购买此 Skill 或取得有效订阅后，即可在线测试。" : "登录后即可确认此 Skill 的使用权限。"}</p>{delivery}</div> } : {}),
      } }} />
      <SkillDetail title={skill.article.title} summary={skill.article.summary} markdown={skill.markdown} chapters={chapters} />
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
