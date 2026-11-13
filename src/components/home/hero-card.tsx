import type { ReactNode } from "react";
import { HeroActions } from "@/components/home/hero-actions";
import { HeroParallax } from "@/components/home/hero-parallax";
import { FactBadges } from "@/components/home/fact-badges";
import type { ResolvedFactBadge } from "@/lib/get-home";
import type { HeroConfig } from "@/types/site";

/**
 * 名片 Hero（页面契约 3.1 块 1）：大 banner 背景图 + 第一人称一句话 + 副标题 +
 * 行动按钮（订阅 / 和我聊聊）+ 事实徽章与专注/不做摘要。
 * 布局居中或左对齐；左对齐可配右侧图片，随滚动视差缩放。
 * 两套横幅和前景跟随外观模式，每套未配置时使用对应内置背景。
 */

export const DEFAULT_HERO_BANNER = "/assets/hero-cloud-glass.svg";
export const DEFAULT_HERO_DARK_BANNER = "/assets/hero-terminal-wave.svg";

export function HeroCard({
  oneLiner,
  hero,
  facts,
  focusAreas,
  exclusions,
  bannerLightUrl,
  bannerDarkUrl,
  bannerEnabled = true,
  subscribeIcon,
  subscribeHint,
}: {
  oneLiner: string;
  hero: HeroConfig;
  facts: ResolvedFactBadge[];
  focusAreas: string[];
  exclusions: string[];
  bannerLightUrl: string | null;
  bannerDarkUrl: string | null;
  /** 站主可关闭横幅背景图；Hero 文字与按钮照常显示 */
  bannerEnabled?: boolean;
  subscribeIcon?: ReactNode;
  subscribeHint?: string | null;
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
  const image = hero.layout === "left" && hero.imageUrl ? hero.imageUrl : null;
  return (
    <HeroParallax
      className="opc-hero"
      data-tone="theme"
      data-layout={hero.layout}
      data-image={image ? "" : undefined}
      data-banner={bannerEnabled ? undefined : "off"}
      aria-label="站点介绍"
    >
      {bannerEnabled && <div className="opc-hero__art" aria-hidden>
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
      </div>}
      <div className="opc-hero__content">
        <div className="opc-hero__text">
          <h1>{oneLiner}</h1>
          {hero.subtitle && <p className="opc-hero__subtitle">{hero.subtitle}</p>}
          <HeroActions
            subscribe={hero.actions.subscribe}
            chat={hero.actions.chat}
            subscribeIcon={subscribeIcon}
            subscribeHint={subscribeHint}
          />
          <FactBadges facts={facts} />
          {focusLine && <p className="opc-hero__focus">{focusLine}</p>}
        </div>
        {image && (
          <div className="opc-hero__figure">
            {/* eslint-disable-next-line @next/next/no-img-element -- owner-managed media library image */}
            <img src={image} alt={hero.imageAlt ?? ""} className="opc-hero__picture" />
          </div>
        )}
      </div>
    </HeroParallax>
  );
}
