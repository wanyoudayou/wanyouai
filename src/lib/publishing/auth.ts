import { createHash, timingSafeEqual } from "node:crypto";

export function validPublisherToken(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(createHash("sha256").update(header.slice(7)).digest(), createHash("sha256").update(secret).digest());
}
export function sameSiteOrigin(origin: string | null, siteUrl: string | undefined) {
  try { return !!origin && !!siteUrl && new URL(origin).origin === new URL(siteUrl).origin; }
  catch { return false; }
}
