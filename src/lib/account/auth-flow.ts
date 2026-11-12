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

/** Cookie that carries the post-login destination from the send step to verify/callback. */
export const LOGIN_RETURN_COOKIE = "wanyou_login_next";

/**
 * Same-origin path the reader returns to after login. Rejects absolute,
 * protocol-relative, backslash and control-character forms, and the auth/admin
 * areas (admin has its own owner flow). Falls back to /me.
 */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/me";
  const path = value.trim();
  if (path.length < 1 || path.length > 512 || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return "/me";
  try {
    const url = new URL(path, "https://site.invalid");
    if (url.origin !== "https://site.invalid") return "/me";
    if (/^\/(login|admin|auth|api)(\/|$)/.test(url.pathname)) return "/me";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/me";
  }
}

/** Login URL that returns to `path` afterwards (validated again server-side). */
export function loginHref(path: string): string {
  return `/login?next=${encodeURIComponent(path)}`;
}
