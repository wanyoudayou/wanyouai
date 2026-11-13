import { formatPrice } from "./format";

/** 订阅提示图标白名单：site_config.commerce.subscription_hint.icon 只能引用这些名称（图标组件见 components/reading/subscription-hint.tsx）。 */
export const SUBSCRIPTION_HINT_ICON_NAMES = [
  "coffee",
  "cup-soda",
  "milk",
  "cake-slice",
  "ice-cream",
  "sandwich",
  "utensils",
  "book-open",
  "ticket",
  "gift",
  "heart",
  "sparkles",
] as const;

export type SubscriptionHintIcon = (typeof SUBSCRIPTION_HINT_ICON_NAMES)[number];

export const SUBSCRIPTION_HINT_ICON_LABELS: Record<SubscriptionHintIcon, string> = {
  coffee: "咖啡",
  "cup-soda": "饮品",
  milk: "牛奶",
  "cake-slice": "蛋糕",
  "ice-cream": "冰淇淋",
  sandwich: "三明治",
  utensils: "一餐",
  "book-open": "书",
  ticket: "票",
  gift: "礼物",
  heart: "心意",
  sparkles: "闪光",
};

export const SUBSCRIPTION_HINT_TEXT_MAX = 40;

export function isSubscriptionHintIcon(value: unknown): value is SubscriptionHintIcon {
  return typeof value === "string" && (SUBSCRIPTION_HINT_ICON_NAMES as readonly string[]).includes(value);
}

/** 年价折合月均：日元取整，其余保留两位小数；仅用于展示，下单金额仍由服务端快照。 */
export function monthlyEquivalent(amount: number, currency: string): number {
  const digits = currency.toUpperCase() === "JPY" ? 0 : 2;
  const factor = 10 ** digits;
  return Math.round((amount / 12) * factor) / factor;
}

/** 订阅按钮下方的提示行：「约 ¥8.25 / 月 · 站主文案」；未配置提示时返回 null。 */
export function subscriptionHintLine(
  price: { amount: number; currency: string } | null,
  hint: { icon: SubscriptionHintIcon | null; text: string | null } | null,
): string | null {
  if (!price || !hint) return null;
  const monthly = `约 ${formatPrice(monthlyEquivalent(price.amount, price.currency), price.currency)} / 月`;
  return hint.text ? `${monthly} · ${hint.text}` : monthly;
}
