import { HeroAskBox } from "@/components/home/hero-ask-box";
import { FactBadges } from "@/components/home/fact-badges";
import type { ResolvedFactBadge } from "@/lib/get-home";

/**
 * 名片 Hero（页面契约 3.1 块 1）：大 banner 背景图 + 第一人称一句话 +
 * 事实徽章行 + 问句输入框 + 专注/不做摘要。
 * 订阅 pill 仅左栏底部常驻（契约 2.1/2.4），Hero 内不渲染。
 * 两套横幅和前景跟随外观模式，每套未配置时使用对应内置背景。
 */

export const DEFAULT_HERO_BANNER = "/assets/hero-cloud-glass.svg";
export const DEFAULT_HERO_DARK_BANNER = "/assets/hero-terminal-wave.svg";

export function HeroCard({
  oneLiner,
  facts,
  askPlaceholder,
  focusAreas,
  exclusions,
  bannerLightUrl,
  bannerDarkUrl,
}: {
  oneLiner: string;
  facts: ResolvedFactBadge[];
  askPlaceholder: string;
  focusAreas: string[];
  exclusions: string[];
  bannerLightUrl: string | null;
  bannerDarkUrl: string | null;
}) {
  const focusLine = [
    focusAreas.length > 0 ? `专注：${focusAreas.join(" · ")}` : null,
    exclusions.length > 0 ? `不做：${exclusions.join("、")}` : null,
  ]
    .filter(Boolean)
    .join("　");

  const customLight = bannerLightUrl && bannerLightUrl !== DEFAULT_HERO_BANNER
    ? bannerLightUrl : null;
  const customDark = bannerDarkUrl && bannerDarkUrl !== DEFAULT_HERO_DARK_BANNER
    ? bannerDarkUrl : null;
  return (
    <section
      className="opc-hero"
      data-tone="theme"
      aria-label="站点介绍"
    >
      <div className="opc-hero__art" aria-hidden>
        <div
          className="opc-hero__layer opc-hero__image--light"
          data-custom={customLight ? "true" : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-managed or local theme artwork */}
          <img
            src={customLight ?? DEFAULT_HERO_BANNER}
            alt=""
            className="opc-hero__image"
          />
        </div>
        <div
          className="opc-hero__layer opc-hero__image--dark"
          data-custom={customDark ? "true" : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-managed or local theme artwork */}
          <img
            src={customDark ?? DEFAULT_HERO_DARK_BANNER}
            alt=""
            className="opc-hero__image"
          />
        </div>
      </div>
      <div className="opc-hero__content">
        <h1>{oneLiner}</h1>
        <FactBadges facts={facts} />
        <div className="opc-hero__question">
          <HeroAskBox placeholder={askPlaceholder} />
        </div>
        {focusLine && <p className="opc-hero__focus">{focusLine}</p>}
      </div>
    </section>
  );
}
