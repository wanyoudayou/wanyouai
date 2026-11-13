import { CoffeeIcon } from "lucide-react";
import { HeroCard } from "@/components/home/hero-card";
export default async function Page({ searchParams }: { searchParams: Promise<{ banner?: string }> }) {
  const { banner } = await searchParams;
  return (
    <>
      <HeroCard
        oneLiner="帮独立创作者把知识变成可持续的服务。"
        hero={{
          subtitle: "手册、技能与一对一服务放在同一个站点，读者按需阅读、订阅或直接和我聊聊。",
          layout: "left",
          imageUrl: "/assets/custom-banner.svg?side=1",
          imageAlt: "站点工作台示意图",
          actions: { subscribe: { enabled: true, label: null }, chat: { enabled: true, label: null } },
        }}
        facts={[{ type: "article_count", text: "文章 12 篇" }]}
        focusAreas={["知识产品", "独立创作"]}
        exclusions={["代运营"]}
        bannerLightUrl={null}
        bannerDarkUrl={null}
        bannerEnabled={banner !== "off"}
        subscribeIcon={<CoffeeIcon aria-hidden="true" />}
        subscribeHint="约 ¥8.25 / 月 · 一杯美式的价格"
      />
      <div className="h-[1600px] p-6">后续内容</div>
    </>
  );
}
