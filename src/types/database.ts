/**
 * Row types matching supabase/legacy/schema.sql.
 * Keep in sync with the SQL artifacts; regenerate manually when the schema changes.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type SeriesType = "collection" | "handbook" | "skill" | "event";
export type ContentStatus = "draft" | "published" | "paused" | "archived";
export type ArticleAccess = "public" | "registered" | "subscriber" | "paid";
export type EventState = "upcoming" | "registering" | "ended";

export interface SiteConfigRow {
  id: number;
  site_name: string;
  tagline: string | null;
  owner_name: string;
  footer_credit: boolean;
  avatar_config: Json;
  home_config: Json;
  constraints: Json;
  identity: Json;
  contact: Json;
  commerce: Json;
  updated_at: string;
}

export interface SeriesRow {
  id: number;
  slug: string;
  type: SeriesType;
  title: string;
  readme_article_id: number | null;
  price: number;
  status: ContentStatus;
  tags: string[];
  task: string | null;
  audiences: string[];
  featured: boolean;
  created_at: string;
  updated_at: string;
}

/** Articles as consumed by list/card surfaces. Never includes body content. */
export interface ArticleCardRow {
  id: number;
  slug: string;
  series_id: number | null;
  type: "blog" | "chapter" | "skill";
  title: string;
  summary: string | null;
  cover_url: string | null;
  tags: string[];
  access: ArticleAccess;
  price: number | null;
  status: ContentStatus;
  published_at: string | null;
}

export interface EventDetailsRow {
  series_id: number;
  starts_at: string;
  location_text: string | null;
  registration: string | null;
  capacity: string | null;
  kind: "member" | "open";
  ticket_price: number | null;
  state: EventState;
}

/**
 * event_details.series_id 是主键，PostgREST 对一对一嵌入返回对象而非数组；
 * 两种形态都兼容。
 */
export type EventSeriesRow = SeriesRow & {
  event_details: EventDetailsRow | EventDetailsRow[] | null;
};

export interface ServiceCardRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  deliverables: string[];
  duration: string | null;
  price: number | null;
  capacity_per_month: number | null;
  status: ContentStatus;
  sort: number;
}
