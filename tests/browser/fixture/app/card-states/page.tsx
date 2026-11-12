import { AlbumCard } from "@/components/cards/album-card";
import { ArticleCard } from "@/components/cards/article-card";
import { EventCard } from "@/components/cards/event-card";
import { ServiceCard } from "@/components/cards/service-card";
import "@/styles/cards.css";

export default function CardStatesPage() {
  return (
    <section className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">卡片视觉与交互</h1>
      <div className="grid gap-6 sm:grid-cols-2">
        <ArticleCard
          data={{
            href: "/blog/example",
            title: "设计可持续的个人工作方式",
            summary: "从一个明确的方向开始，建立可复用的日常工作流程。",
            coverUrl: "/assets/custom-banner.svg",
            tags: ["实践", "创作"],
            access: "public",
            price: null,
            publishedAt: "2026-10-15T00:00:00Z",
          }}
        />
        <AlbumCard
          data={{
            href: "/collections/example",
            kind: "collection",
            title: "从部署到发布",
            summary: "用清晰的工具组织内容、配置业务并开始创作。",
            coverUrl: null,
            tags: ["使用指南"],
            audiences: ["独立创作者"],
            price: 0,
            currency: "CNY",
            featured: false,
            chapterCount: 8,
          }}
        />
        <ServiceCard
          currency="CNY"
          data={{
            slug: "example",
            title: "产品设计与工作流程咨询",
            summary: "围绕一个真实问题，梳理目标并形成可以执行的下一步。",
            deliverables: ["需求分析", "行动建议"],
            duration: "60 分钟",
            price: null,
            capacityPerMonth: 4,
          }}
        />
        <EventCard
          timezone="Asia/Shanghai"
          currency="CNY"
          data={{
            href: "/events/example",
            title: "独立创作者线上交流",
            summary: "分享最近的实践与遇到的问题。",
            coverUrl: null,
            tags: ["线上交流"],
            state: "registering",
            startsAt: "2026-10-20T12:00:00Z",
            locationText: "线上",
            ticketPrice: 0,
            memberOnly: false,
          }}
        />
      </div>
    </section>
  );
}
