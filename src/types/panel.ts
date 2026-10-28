/**
 * 右栏占位内容（页面契约 2.3）：
 * 会话未开始时按页面上下文渲染——首页=详细名片卡片区（CardPanel，
 * 与 /card 页同一组件同源）；讨论页=tips；其余=默认招呼。
 */
export interface CardPanelService {
  slug: string;
  title: string;
  price: number | null;
  protocol?: Record<string, string>;
}

import type { SocialLink } from "@/types/site";

export interface CardPanelData {
  siteName: string;
  ownerName: string;
  /** 站主头像（identity.avatar_url）；null = 前台退化为首字徽标 */
  avatarUrl: string | null;
  oneLiner: string;
  languages: string[];
  timezone: string;
  focusAreas: string[];
  workingHours: string;
  responseTime: string;
  currentLoad: string;
  exclusions: string[];
  email: string | null;
  bookingUrl: string | null;
  /** 自媒体平台露出（identity.social_links） */
  socialLinks: SocialLink[];
  /** 交易锚定评价（公开、不含个人信息；最新若干条） */
  evaluations: { id: number; rating: number; content: string | null; created_at: string }[];
  subscriptionPriceText: string | null;
  services: CardPanelService[];
  seriesCount: number;
  articleCount: number;
  cardJsonUrl: string;
}

export type PanelPlaceholder =
  | { kind: "default" }
  | { kind: "tips"; title: string; items: string[] }
  | { kind: "card"; card: CardPanelData };
