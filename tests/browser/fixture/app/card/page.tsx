import { CardIdentityAside } from "@/components/card/card-identity-aside";

export default function Page() {
  return <section className="max-w-sm space-y-6 p-6">
    <CardIdentityAside cardJsonUrl="https://example.test/card.json" card={{
      siteName: "示例工作室", ownerName: "示例站主", avatarUrl: null, oneLiner: "公开的内容与服务。",
      languages: ["zh-CN"], timezone: "Asia/Shanghai", focusAreas: [], workingHours: "工作日",
      responseTime: "两个工作日", currentLoad: "可预约", exclusions: [], email: null, bookingUrl: null,
      socialLinks: [], evaluations: [], subscriptionPriceText: null, services: [], seriesCount: 0, articleCount: 0,
      cardJsonUrl: "https://example.test/card.json",
    }} />
  </section>;
}
