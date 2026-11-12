import type { ArticleCardRow, ContentStatus, EventDetailsRow, SeriesRow } from "@/types/database";

export type ReadingArticle = ArticleCardRow & { preview_md: string };
export type ReadingSeries = SeriesRow;
export interface Entitlement {
  user_id: string;
  type: "subscription" | "series" | "single" | "event" | "skill";
  target_id: number | null;
  ends_at: string | null;
  revoked_at: string | null;
}
export interface Reader {
  userId: string | null;
  owner: boolean;
  entitlements: Entitlement[];
}
export interface ArticleReading {
  article: ReadingArticle;
  markdown: string;
  full: boolean;
}
export interface ChapterLink {
  href: string;
  title: string;
  slug: string;
  locked: boolean;
  readme: boolean;
  status: ContentStatus;
}
export interface ChapterNavigation {
  pathname: string;
  title: string;
  backHref: string;
  currentSlug: string | null;
  chapters: ChapterLink[];
}
export interface SeriesReading {
  series: ReadingSeries;
  reading: ArticleReading | null;
  navigation: ChapterNavigation;
  isReadme: boolean;
  event: EventDetailsRow | null;
  canDownload: boolean;
}
