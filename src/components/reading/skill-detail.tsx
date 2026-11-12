import Link from "next/link";
import { SkillDelivery } from "@/components/reading/skill-delivery";
import { MarkdownContent } from "@/components/reading/markdown-content";
import { PurchaseButton } from "@/components/reading/purchase-button";
import { formatPrice } from "@/lib/format";
import { loginHref } from "@/lib/account/auth-flow";

export type SkillDetailRelease = { id: string; version: string; notes: string | null; manifest: { path: string; size: number }[] };

/** Skill 交付区：版本说明、登录 / 购买 / 下载入口。权限由页面服务端判定后传入。 */
export function SkillDeliverySection({ slug, usageGuide, hasRelease, loggedIn, allowed, release, published, price, currency, paymentEnabled, skillId }: {
  slug: string; usageGuide: string | null; hasRelease: boolean; loggedIn: boolean; allowed: boolean;
  release: SkillDetailRelease | null; published: boolean; price: number; currency: string; paymentEnabled: boolean; skillId: number;
}) {
  return <section className="min-w-0 space-y-4">
    <p className="whitespace-pre-wrap text-sm">{usageGuide || "下载后在支持 Agent Skills 的工具中安装。网站不会执行包内脚本。"}</p>
    {!hasRelease ? <p className="text-sm text-muted-foreground">版本包准备中，暂未开放购买和下载。</p>
      : !loggedIn ? <Link href={loginHref(`/skills/${slug}`)} className="text-primary">登录后{price > 0 ? "购买或使用" : "免费使用"}</Link>
      : allowed && release ? <>
        <SkillDelivery release={release.id} version={release.version} />
        <details className="text-sm"><summary>此版本更新说明与文件清单</summary><p className="my-3 whitespace-pre-wrap">{release.notes}</p><ul>{release.manifest.map(f => <li key={f.path} className="break-all">{f.path} · {f.size} 字节</li>)}</ul></details>
      </>
      : published ? <PurchaseButton skuType="skill" targetId={skillId} label={`购买 · ${formatPrice(price, currency)}`} enabled={paymentEnabled} />
      : <p className="text-sm">此 Skill 已停售；已有有效权益的账户仍可使用。</p>}
  </section>;
}

/** Skill 公开介绍正文与兼容的旧章节入口。 */
export function SkillDetail({ title, summary, markdown, chapters }: { title: string; summary: string | null; markdown: string; chapters: { href: string; title: string }[] }) {
  return <>
    <Link href="/skills" className="text-sm text-primary">所有 SKILL</Link>
    <header className="space-y-3"><h1 className="text-3xl font-semibold">{title}</h1><p className="text-muted-foreground">{summary}</p></header>
    <MarkdownContent markdown={markdown} />
    {chapters.length > 0 && <section className="space-y-3">
      <h2 className="text-lg font-semibold">原有章节与资料</h2>
      <p className="text-sm text-muted-foreground">保留原有阅读权限；已购买此技能的账户可继续阅读。</p>
      <ul className="space-y-2">{chapters.map(c => <li key={c.href}><Link className="text-primary underline" href={c.href}>{c.title}</Link></li>)}</ul>
    </section>}
  </>;
}
