import { isRetiredTemplateImage } from "../lib/retired-template-images";

/**
 * Parsed site_config JSON shapes, guarded by normalize functions.
 * Mirrors docs/contracts/site-config.schema.json — runtime normalization is
 * defensive: a misconfigured row degrades to documented defaults, never to a crash.
 */

export type HomeBlockType = "blog" | "handbook" | "skill" | "event" | "service";

export interface HomeBlockConfig {
  type: HomeBlockType;
  enabled: boolean;
  title: string;
  empty_text: string | null;
  cta_label: string | null;
  limit: number;
}

export type FactBadgeType = "series_count" | "article_count" | "subscription_price" | "service_capacity";

export interface FactBadgeConfig {
  type: FactBadgeType;
  label: string | null;
}

export interface HomeConfig {
  askPlaceholder: string;
  /** 各主题独立的横幅；null = 使用对应主题的内置背景。 */
  bannerLightUrl: string | null;
  bannerDarkUrl: string | null;
  /** 名片 Hero 是否显示（固定首屏，不参与五块排序） */
  heroEnabled: boolean;
  /** 首页自定义区（Hero 与五块之间）；html 保存时已净化 */
  customZone: { enabled: boolean; html: string };
  factBadges: FactBadgeConfig[];
  blocks: HomeBlockConfig[];
}

export const SOCIAL_PLATFORMS = {
  x: { label: "X（Twitter）", mark: "𝕏" },
  github: { label: "GitHub", mark: "GH" },
  xiaohongshu: { label: "小红书", mark: "书" },
  xiaoyuzhou: { label: "小宇宙", mark: "宇" },
  "wechat-official": { label: "公众号", mark: "微" },
  custom: { label: "自定义平台", mark: "↗" },
} as const;
export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
export interface SocialLink {
  platform: SocialPlatform;
  label: string;
  url: string;
  /** 平台标记下方的补充说明（可选） */
  note?: string;
}

export interface IdentityConfig {
  oneLiner: string;
  languages: string[];
  timezone: string;
  focusAreas: string[];
  /** 站点 Logo（左栏标识）；null = 退化为站名首字徽标 */
  logoUrl: string | null;
  /** 站主头像（右栏名片）；null = 退化为站主名称首字徽标 */
  avatarUrl: string | null;
  /** 名片页自定义区（履历主体之后）；html 保存时已净化 */
  customZone: { enabled: boolean; html: string };
  /** 自媒体平台露出（名片「实证」区） */
  socialLinks: SocialLink[];
  /** 名片页是否显示订阅方案卡片（左列 profile 下方）；缺省 true */
  showSubscriptionCard: boolean;
}

export interface ConstraintsConfig {
  workingHours: string;
  responseTime: string;
  currentLoad: string;
  exclusions: string[];
}

export interface ContactConfig {
  email: string | null;
  bookingUrl: string | null;
}

export interface CommerceConfig {
  paymentEnabled: boolean;
  /** 已启用的 zpay 渠道（买家在核对页选择）；缺省 ["alipay"]。 */
  paymentChannels: ("alipay" | "wxpay")[];
  subscriptionPrice: { amount: number; currency: string } | null;
  refundPolicyUrl: string | null;
  /** 左栏订阅 pill 落点自定义页 slug；null = 默认名片页（/card#pricing） */
  subscribePage: string | null;
}

export interface AvatarConfig {
  /** 分身总开关（一键关闭）；默认关。 */
  enabled: boolean;
  model: string | null;
  /** 月度生成次数上限（站级熔断护栏）；null = 不设限。 */
  monthlyLimit: number | null;
  anonymousEntry: boolean;
}

export const HOME_BLOCK_TITLES: Record<HomeBlockType, string> = {
  blog: "博客",
  handbook: "手册",
  skill: "技能",
  event: "活动",
  service: "服务",
};

export const DEFAULT_HOME_BLOCKS: HomeBlockConfig[] = (
  ["blog", "handbook", "skill", "event", "service"] as const
).map((type) => ({
  type,
  enabled: true,
  title: HOME_BLOCK_TITLES[type],
  empty_text: null,
  cta_label: null,
  limit: 6,
}));

const BLOCK_TYPES = new Set<string>(Object.keys(HOME_BLOCK_TITLES));
const BADGE_TYPES = new Set<string>(["series_count", "article_count", "subscription_price", "service_capacity"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 6;
  return Math.min(24, Math.max(1, Math.round(value)));
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : null;
}

function optionalImage(value: unknown): string | null {
  const image = optionalString(value, 2048);
  return image && !isRetiredTemplateImage(image) ? image : null;
}

/** Enforce the five fixed blocks (each exactly once), keeping configured order. */
export function normalizeHomeConfig(raw: unknown): HomeConfig {
  const source = isRecord(raw) ? raw : {};

  const ask = optionalString(source.ask_placeholder ?? (isRecord(source.hero) ? source.hero.ask_placeholder : null), 80);

  const rawBadges = Array.isArray(source.fact_badges) ? source.fact_badges : [];
  const factBadges: FactBadgeConfig[] = [];
  for (const item of rawBadges) {
    if (!isRecord(item) || typeof item.type !== "string" || !BADGE_TYPES.has(item.type)) continue;
    if (factBadges.some((b) => b.type === item.type)) continue;
    factBadges.push({ type: item.type as FactBadgeType, label: optionalString(item.label, 40) });
    if (factBadges.length >= 6) break;
  }

  const rawHero = isRecord(source.hero) ? source.hero : {};
  // 旧类型名映射（latest_blog/upcoming_events/services → blog/event/service；showcase 取消；identity → hero 开关）
  const LEGACY_TYPE: Record<string, HomeBlockType> = { latest_blog: "blog", upcoming_events: "event", services: "service" };
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks : [];
  const seen = new Set<string>();
  const blocks: HomeBlockConfig[] = [];
  let heroEnabled = rawHero.enabled !== false;
  for (const item of rawBlocks) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    if (item.type === "identity") { heroEnabled = item.enabled !== false; continue; }
    const mapped: HomeBlockType | undefined = BLOCK_TYPES.has(item.type) ? (item.type as HomeBlockType) : LEGACY_TYPE[item.type];
    if (!mapped) continue;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    blocks.push({
      type: mapped,
      enabled: item.enabled !== false,
      title: optionalString(item.title, 60) ?? HOME_BLOCK_TITLES[item.type as HomeBlockType],
      empty_text: optionalString(item.empty_text, 120),
      cta_label: optionalString(item.cta_label, 40),
      limit: clampLimit(item.limit),
    });
  }
  for (const fallback of DEFAULT_HOME_BLOCKS) {
    if (!seen.has(fallback.type)) blocks.push({ ...fallback });
  }

  // 既有单张横幅保留为浅色版；下一次保存使用双主题字段。
  const bannerLightUrl = optionalImage(rawHero.banner_light_url ?? source.banner_url ?? rawHero.banner_url);
  const bannerDarkUrl = optionalImage(rawHero.banner_dark_url);

  const rawZone = isRecord(source.custom_zone) ? source.custom_zone : {};
  return {
    askPlaceholder: ask ?? "想问什么，直接向站主的分身提问",
    bannerLightUrl,
    bannerDarkUrl,
    heroEnabled,
    customZone: {
      enabled: rawZone.enabled === true,
      html: typeof rawZone.html === "string" ? rawZone.html.slice(0, 200000) : "",
    },
    factBadges,
    blocks,
  };
}

export function normalizeIdentityConfig(raw: unknown): IdentityConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    oneLiner:
      optionalString(source.one_liner, 180) ??
      "帮一人公司把知识、服务与活动整理成可持续经营的工作区",
    languages: Array.isArray(source.languages)
      ? source.languages.filter((l): l is string => typeof l === "string").slice(0, 4)
      : [],
    timezone: optionalString(source.timezone, 64) ?? "Asia/Shanghai",
    focusAreas: Array.isArray(source.focus_areas)
      ? source.focus_areas.filter((f): f is string => typeof f === "string").slice(0, 12)
      : [],
    logoUrl: optionalImage(source.logo_url),
    avatarUrl: optionalImage(source.avatar_url),
    customZone: (() => {
      const zone = isRecord(source.custom_zone) ? source.custom_zone : {};
      return { enabled: zone.enabled === true, html: typeof zone.html === "string" ? zone.html.slice(0, 200000) : "" };
    })(),
    showSubscriptionCard: source.show_subscription_card !== false,
    socialLinks: (Array.isArray(source.social_links) ? source.social_links : []).flatMap((item) => {
      if (!isRecord(item) || typeof item.platform !== "string" || !(item.platform in SOCIAL_PLATFORMS)) return [];
      const label = optionalString(item.label, 40);
      const url = optionalString(item.url, 2048);
      if (!label || !url || (!/^https:\/\//.test(url) && !url.startsWith("/"))) return [];
      const note = optionalString(item.note, 80);
      return [{ platform: item.platform as SocialPlatform, label, url, ...(note ? { note } : {}) }];
    }).slice(0, 8),
  };
}

export function normalizeConstraintsConfig(raw: unknown): ConstraintsConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    workingHours: optionalString(source.working_hours, 120) ?? "",
    responseTime: optionalString(source.response_time, 120) ?? "",
    currentLoad: optionalString(source.current_load, 80) ?? "",
    exclusions: Array.isArray(source.exclusions)
      ? source.exclusions.filter((e): e is string => typeof e === "string").slice(0, 30)
      : [],
  };
}

/** 页面选择器引用过滤：被引用的自定义页不存在或未发布时返回 null（按未配置降级，避免死链）。 */
export function filterStalePageRef(raw: unknown, key: "booking_page" | "refund_policy_page" | "subscribe_page", published: ReadonlySet<string>): unknown {
  if (!isRecord(raw)) return raw;
  const slug = raw[key];
  if (typeof slug !== "string" || slug === "") return raw;
  return published.has(slug) ? raw : { ...raw, [key]: "" };
}

function pageHref(slug: unknown): string | null {
  // 预约/退款政策 = 自定义页面选择器（slug → 站内 /p/{slug}）；历史 booking_url/refund_policy_url 外链仅兼容保留
  if (typeof slug === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) return `/p/${slug}`;
  return null;
}

export function normalizeContactConfig(raw: unknown): ContactConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    email: optionalString(source.email, 254),
    bookingUrl: pageHref(source.booking_page) ?? optionalString(source.booking_url, 2048),
  };
}

export function normalizeCommerceConfig(raw: unknown): CommerceConfig {
  const source = isRecord(raw) ? raw : {};
  let subscriptionPrice: CommerceConfig["subscriptionPrice"] = null;
  const price = source.subscription_price;
  if (isRecord(price) && typeof price.amount === "number" && price.amount > 0) {
    subscriptionPrice = {
      amount: price.amount,
      currency: typeof price.currency === "string" ? price.currency : "CNY",
    };
  }
  const channels = Array.isArray(source.payment_channels) ? source.payment_channels.filter((c): c is "alipay" | "wxpay" => c === "alipay" || c === "wxpay") : [];
  return {
    paymentEnabled: source.payment_enabled === true,
    paymentChannels: channels.length ? channels : ["alipay"],
    subscriptionPrice,
    refundPolicyUrl: pageHref(source.refund_policy_page) ?? optionalString(source.refund_policy_url, 2048),
    subscribePage: pageHref(source.subscribe_page) ? (source.subscribe_page as string) : null,
  };
}

export function normalizeAvatarConfig(raw: unknown): AvatarConfig {
  const source = isRecord(raw) ? raw : {};
  return {
    enabled: source.enabled === true && source.knowledge_ready === true,
    model: null,
    monthlyLimit: typeof source.monthly_limit === "number" && Number.isFinite(source.monthly_limit) && source.monthly_limit >= 0 ? source.monthly_limit : null,
    anonymousEntry: source.anonymous_entry === true,
  };
}
