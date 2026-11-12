/**
 * Domain-neutral card data consumed by components in src/components/cards.
 * Produced by data functions in src/lib; components never touch Supabase rows.
 */

import type { ArticleAccess, EventState, SeriesType } from "@/types/database";

export interface AlbumEventMeta {
  startsAt: string;
  state: EventState;
  ticketPrice: number | null;
}

export interface AlbumManifestItem {
  path: string;
  size: number;
}

export interface AlbumCardData {
  owned?: boolean;
  href: string;
  kind: SeriesType;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  tags: string[];
  audiences: string[];
  /** 0 means free; null means a Skill package is not available yet. */
  price: number | null;
  /** currency code for price (site commerce currency) */
  currency: string;
  featured: boolean;
  /** 栏目卡扩展：章节数（series 卡片） */
  chapterCount?: number;
  /** 栏目卡扩展：活动元数据 */
  event?: AlbumEventMeta | null;
  /** 栏目卡扩展：技能文件包清单（产出物预览主视觉） */
  manifest?: AlbumManifestItem[] | null;
  /** 已发布普通章节的访问级别；README 单独公开。 */
  accesses?: ArticleAccess[];
  /** 排序键：更新时间 */
  updatedAt?: string;
}

export interface ArticleCardData {
  owned?: boolean;
  href: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  tags: string[];
  access: ArticleAccess;
  price: number | null;
  publishedAt: string | null;
}

export interface EventCardData {
  href: string;
  title: string;
  summary: string | null;
  coverUrl: string | null;
  tags: string[];
  state: EventState;
  startsAt: string;
  locationText: string | null;
  /** null means 免费/未定价活动 */
  ticketPrice: number | null;
  memberOnly: boolean;
}

export interface ServiceCardData {
  slug: string;
  title: string;
  summary: string | null;
  deliverables: string[];
  duration: string | null;
  price: number | null;
  capacityPerMonth: number | null;
}
