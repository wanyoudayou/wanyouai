const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "JP¥",
  HKD: "HK$",
};

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
