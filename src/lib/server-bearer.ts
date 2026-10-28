import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/** Bearer 密钥比对（sha256 后 timingSafeEqual）。任一配置密钥匹配即通过；未配置任何密钥时一律拒绝。 */
export function bearerMatches(request: Request, ...secrets: (string | undefined)[]): boolean {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!bearer) return false;
  const digest = createHash("sha256").update(bearer).digest();
  return secrets.some((secret) => typeof secret === "string" && secret.length > 0 && timingSafeEqual(digest, createHash("sha256").update(secret).digest()));
}
