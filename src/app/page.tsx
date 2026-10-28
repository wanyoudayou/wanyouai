import { getSiteConfig } from "@/lib/get-site-config";
import { getHomeData } from "@/lib/get-home";
import { buildCardPanelData } from "@/lib/get-card";
import { PanelPlaceholder } from "@/components/shell/panel-placeholder";
import { HeroCard } from "@/components/home/hero-card";
import { CustomHtmlWithWidgets } from "@/components/custom/custom-html-widgets";
import { SectionHeader } from "@/components/home/section-header";
import { CardGrid } from "@/components/cards/card-grid";
import { AlbumCard } from "@/components/cards/album-card";
import { ArticleCard } from "@/components/cards/article-card";
import { EventCard } from "@/components/cards/event-card";
import { ServiceCard } from "@/components/cards/service-card";
import type { HomeBlockConfig } from "@/types/site";
import type { ReactNode } from "react";

/**
 * `/` 首页（页面契约 3.1）：固定五块模板，内容动态精选。
 * 配置管显隐/顺序/文案；空块整块隐藏；无个性化、无算法。
 */

export default async function Home() {
  const site = await getSiteConfig();
  const data = await getHomeData(site.home, site);
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  const card = buildCardPanelData(site, {
    services: data.services,
    series: data.counts.series,
    articles: data.counts.articles,
  });

  const renderBlock = (block: HomeBlockConfig): ReactNode => {
    if (!block.enabled) return null;
    switch (block.type) {
      case "blog":
        if (data.latestBlog.length === 0) return null;
        return (
          <section
            key={block.type}
            className="space-y-6"
            aria-label={block.title}
          >
            <SectionHeader
              title={block.title}
              count={data.latestBlog.length}
              href="/blog"
              ctaLabel={block.cta_label ?? "查看全部"}
            />
            <CardGrid>
              {data.latestBlog.map((article) => (
                <ArticleCard key={article.href} data={article} />
              ))}
            </CardGrid>
          </section>
        );
      case "handbook":
      case "skill": {
        const items = data.albums[block.type];
        if (items.length === 0) return null;
        return (
          <section
            key={block.type}
            className="space-y-6"
            aria-label={block.title}
          >
            <SectionHeader
              title={block.title}
              count={data.albumCounts[block.type]}
              href={block.type === "handbook" ? "/handbooks" : "/skills"}
              ctaLabel={block.cta_label ?? "查看全部"}
            />
            <CardGrid>
              {items.map((album) => (
                <AlbumCard
                  key={album.href}
                  data={album}
                  timezone={site.identity.timezone}
                />
              ))}
            </CardGrid>
          </section>
        );
      }
      case "event":
        if (data.upcomingEvents.length === 0) return null;
        return (
          <section
            key={block.type}
            className="space-y-6"
            aria-label={block.title}
          >
            <SectionHeader
              title={block.title}
              count={data.upcomingEvents.length}
              href="/events"
              ctaLabel={block.cta_label ?? "查看全部"}
            />
            <CardGrid>
              {data.upcomingEvents.map((event) => (
                <EventCard
                  key={event.href}
                  data={event}
                  timezone={site.identity.timezone}
                  currency={currency}
                />
              ))}
            </CardGrid>
          </section>
        );
      case "service":
        if (data.services.length === 0) return null;
        return (
          <section
            key={block.type}
            className="space-y-6"
            aria-label={block.title}
          >
            <SectionHeader
              title={block.title}
              count={data.services.length}
              href="/services"
              ctaLabel={block.cta_label ?? "查看全部"}
            />
            <CardGrid>
              {data.services.map((service) => (
                <ServiceCard
                  key={service.title}
                  data={service}
                  currency={currency}
                />
              ))}
            </CardGrid>
          </section>
        );
    }
  };

  // 名片 Hero 是固定首屏（不参与五块排序）；五块 = 博客/手册/技能/活动/服务
  const hero = site.home.heroEnabled ? (
    <HeroCard
      oneLiner={site.identity.oneLiner}
      facts={data.facts}
      askPlaceholder={site.home.askPlaceholder}
      focusAreas={site.identity.focusAreas}
      exclusions={site.constraints.exclusions}
      bannerLightUrl={site.home.bannerLightUrl}
      bannerDarkUrl={site.home.bannerDarkUrl}
    />
  ) : null;
  const rest = site.home.blocks;

  return (
    <>
      {hero}
      {/* 首页自定义区：Hero 与五个内容区块之间（站点配置控制显隐，保存时已净化） */}
      {site.home.customZone.enabled && site.home.customZone.html ? (
        <section
          className="mx-auto w-full max-w-5xl px-6 pt-12 lg:px-8"
          aria-label="自定义区"
        >
          <CustomHtmlWithWidgets html={site.home.customZone.html} />
        </section>
      ) : null}
      <div className="mx-auto w-full max-w-5xl px-6 py-12 lg:px-8">
        <PanelPlaceholder value={{ kind: "card", card }} />
        <div className="flex flex-col gap-16">{rest.map(renderBlock)}</div>
      </div>
    </>
  );
}

export async function generateMetadata() {
  const { publicMetadata } = await import("@/lib/seo/server");
  const site = await getSiteConfig();
  return publicMetadata(site.siteName, "/");
}
