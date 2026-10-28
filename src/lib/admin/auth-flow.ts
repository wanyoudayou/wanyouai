/** Use the configured canonical origin, never a client-controlled Host/next URL. */
export function adminCallbackUrl(siteUrl: string | undefined) {
  if (!siteUrl) throw new Error("站点地址尚未配置");
  const url = new URL(siteUrl);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("站点地址无效");
  return new URL("/auth/callback", url.origin).href;
}
export function validAdminEmail(value: FormDataEntryValue | null): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
