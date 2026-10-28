// Deployment preflight registry. Keep every message independent of secret values.
const configured = (value) => Boolean(value?.trim()) && !/^(your-|replace-)/i.test(value.trim());
const email = (value) => value !== "owner@example.com" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value ?? "");
const https = (value) => { try { const url = new URL(value); return configured(value) && url.protocol === "https:" && !url.hostname.startsWith("your-"); } catch { return false; } };
const siteUrl = (value) => {
  try {
    const url = new URL(value);
    return !value.endsWith("/") && url.username === "" && url.password === "" && url.search === "" && url.hash === ""
      && url.pathname === "/" && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { return false; }
};

// This only rejects known public keys; Supabase still authenticates every request.
export function isPublicSupabaseKey(value) {
  if (typeof value !== "string") return false;
  const key = value.trim();
  if (key.startsWith("sb_publishable_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return ["anon", "authenticated"].includes(payload.role);
  } catch { return false; }
}

export const baseConfig = [
  { id: "SITE_URL", valid: siteUrl, hint: "填写站点根地址；生产环境使用 HTTPS，不带路径和尾斜杠。" },
  { id: "NEXT_PUBLIC_SUPABASE_URL", valid: https, hint: "填写 Supabase Project URL（HTTPS）。" },
  { id: "NEXT_PUBLIC_SUPABASE_ANON_KEY", valid: configured, hint: "推荐填写 NEXT_PUBLIC_SUPABASE_URL 对应项目的 Publishable key（sb_publishable_ 开头）。" },
  { id: "SUPABASE_SERVICE_ROLE_KEY", valid: (value) => configured(value) && !isPublicSupabaseKey(value), hint: "推荐填写 NEXT_PUBLIC_SUPABASE_URL 对应项目的 Secret key（sb_secret_ 开头）；兼容已有 Legacy service_role，不接受 Publishable / anon 公钥。" },
  { id: "PUBLISH_TOKEN", valid: (v) => configured(v) && Buffer.byteLength(v.trim(), "utf8") >= 32, hint: "填写至少 32 字节的随机发布密钥。" },
  { id: "OWNER_EMAIL", valid: email, hint: "填写首次认领站主的邮箱，并用此邮箱登录 /admin。" },
];

export const optionalGroups = [
  { id: "payment", keys: ["ZPAY_BASE_URL", "ZPAY_PID", "ZPAY_KEY"], valid: (e) => https(e.ZPAY_BASE_URL), hint: "zpay 三值同配，且 ZPAY_BASE_URL 必须为 HTTPS。" },
  { id: "transactional_email", keys: ["RESEND_API_KEY", "EMAIL_FROM"], valid: (e) => /@/.test(e.EMAIL_FROM ?? ""), hint: "RESEND_API_KEY 与 EMAIL_FROM 同配。Auth 登录邮件另在 Supabase SMTP 配置。" },
  { id: "turnstile", keys: ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"], hint: "仅检查旧环境配置；新装在 /admin/security 保存密钥对，无需这两项变量。" },
];

export function inspectConfig(env, { existingSite = false } = {}) {
  const checks = baseConfig.map(({ id, valid, hint }) => ({ id, status: id === "OWNER_EMAIL" && existingSite ? "skipped" : valid(env[id]) ? "ready" : "error", hint }));
  for (const group of optionalGroups) {
    const present = group.keys.filter((key) => configured(env[key])).length;
    const status = present === 0 ? "disabled" : present !== group.keys.length || (group.valid && !group.valid(env)) ? "incomplete" : "ready";
    checks.push({ id: group.id, status, hint: group.hint });
  }
  return checks;
}
