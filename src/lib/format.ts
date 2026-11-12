const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "JP¥",
  HKD: "HK$",
  GBP: "£",
  SGD: "S$",
  TWD: "NT$",
};

/** 后台可选的常用展示币种；在线收款（zpay）只按人民币结算。 */
export const CURRENCY_OPTIONS = [
  ["CNY", "人民币 CNY ¥"],
  ["USD", "美元 USD $"],
  ["EUR", "欧元 EUR €"],
  ["HKD", "港币 HKD HK$"],
  ["JPY", "日元 JPY JP¥"],
  ["GBP", "英镑 GBP £"],
  ["SGD", "新加坡元 SGD S$"],
  ["TWD", "新台币 TWD NT$"],
] as const;
export const PAYMENT_CURRENCY = "CNY";

export function formatPrice(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency.toUpperCase()] ?? `${currency} `;
  const hasFraction = !Number.isInteger(amount);
  const text = hasFraction ? amount.toFixed(2) : String(amount);
  return `${symbol}${text}`;
}

export function formatDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    dateStyle: "medium",
  }).format(date);
}

/** 活动票价文案：null = 站主尚未定价；0 = 免费；其余为票价。卡片、详情与报名区共用。 */
export function formatTicketPrice(price: number | string | null, currency: string, prefix = "票价 "): string {
  if (price === null) return "票价待定";
  const amount = Number(price);
  if (!Number.isFinite(amount)) return "票价待定";
  return amount === 0 ? "免费参加" : `${prefix}${formatPrice(amount, currency)}`;
}

/** 日期 + 时间（站点时区）；服务端与客户端渲染一致。 */
export function formatDateTimeFull(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-CN", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date);
}
