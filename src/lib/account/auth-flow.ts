import { validAdminEmail } from "@/lib/admin/auth-flow";

/** Same email discipline as the admin flow. */
export const validUserEmail = validAdminEmail;

/** Use the configured canonical origin, never a client-controlled Host/next URL. */
export function userCallbackUrl(siteUrl: string | undefined) {
  if (!siteUrl) throw new Error("站点地址尚未配置");
  const url = new URL(siteUrl);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error("站点地址无效");
  return new URL("/login/callback", url.origin).href;
}
