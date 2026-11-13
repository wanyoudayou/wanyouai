import { CardPanel } from "@/components/card/card-panel";
import type { CardPanelData } from "@/types/panel";

const card: CardPanelData = {
  siteName: "示例工作室", ownerName: "示例站主", avatarUrl: null, oneLiner: "公开的内容与服务。",
  languages: ["zh-CN"], timezone: "Asia/Shanghai", focusAreas: [], workingHours: "工作日",
  responseTime: "两个工作日", currentLoad: "可预约", exclusions: [], email: null, bookingUrl: null,
  socialLinks: [
    { platform: "x", label: "@example", url: "https://x.com/example" },
    { platform: "github", label: "example", url: "https://github.com/example", note: "开源项目" },
    { platform: "xiaohongshu", label: "示例站主", url: "https://www.xiaohongshu.com/user/profile/example" },
    { platform: "xiaoyuzhou", label: "示例播客", url: "https://www.xiaoyuzhoufm.com/podcast/example" },
    { platform: "wechat-official", label: "示例工作室", url: "https://mp.weixin.qq.com/example" },
    { platform: "custom", label: "个人主页", url: "https://example.com" },
  ],
  evaluations: [], subscriptionPriceText: null, services: [], seriesCount: 0, articleCount: 0,
  cardJsonUrl: "https://example.test/card.json",
};

export default function Page() {
  return <section className="max-w-md p-6"><CardPanel card={card} /></section>;
}
