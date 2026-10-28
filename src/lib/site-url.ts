/** SITE_URL 解析：Agent 可读出口与 card 路由的绝对地址来源。 */
export function getSiteUrl(): string {
  const url = process.env.SITE_URL;
  if (!url) return "";
  return url.replace(/\/+$/, "");
}
