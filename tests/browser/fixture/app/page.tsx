import { HeroCard } from "@/components/home/hero-card";
import { ArticleCard } from "@/components/cards/article-card";
import { AlbumCard } from "@/components/cards/album-card";
export default function Page() {
  return (
    <>
      <HeroCard
        oneLiner="让知识与服务，成为你的事业。"
        facts={[]}
        askPlaceholder="想了解什么？"
        focusAreas={["产品设计", "独立创作"]}
        exclusions={[]}
        bannerLightUrl={null}
        bannerDarkUrl={null}
      />
      <section className="space-y-6 p-6">
        <h2 className="text-2xl font-semibold">内容与指南</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <AlbumCard
            data={{
              href: "/collections/example",
              kind: "collection",
              title: "从部署到发布",
              summary: "用一套清晰的工具组织内容、配置业务并开始创作。",
              tags: ["使用指南"],
              audiences: [],
              price: 0,
              currency: "CNY",
              chapterCount: 8,
              updatedAt: "2026-10-15T00:00:00Z",
            }}
          />
          <ArticleCard
            data={{
              href: "/blog/example",
              title: "设计可持续的个人工作方式",
              summary: "从一个明确的方向开始，建立可复用的日常工作流程。",
              coverUrl: null,
              tags: ["实践"],
              access: "public",
              publishedAt: "2026-10-15T00:00:00Z",
            }}
          />
        </div>
      </section>
    </>
  );
}
