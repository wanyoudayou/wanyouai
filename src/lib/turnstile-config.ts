import type { createSupabaseServerClient } from "./supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;
export type TurnstilePublicConfig = { enabled: boolean; siteKey: string | null; source: "database" | "environment" };
export const validTurnstileKey = (value: string) => /^[A-Za-z0-9_-]{10,200}$/.test(value);

export function resolveTurnstilePublic(raw: unknown, env: Record<string, string | undefined> = process.env): TurnstilePublicConfig {
  if (raw !== null && raw !== undefined) {
    const config = raw as Record<string, unknown>;
    const siteKey = typeof config.site_key === "string" && validTurnstileKey(config.site_key) ? config.site_key : null;
    return { enabled: config.enabled === true && !!siteKey, siteKey, source: "database" };
  }
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
  const paired = validTurnstileKey(siteKey) && validTurnstileKey(env.TURNSTILE_SECRET_KEY?.trim() ?? "");
  return { enabled: paired, siteKey: paired ? siteKey : null, source: "environment" };
}

/** Public pages use the session client and read only the public widget column. */
export async function loadTurnstilePublic(client: Client, env: Record<string, string | undefined> = process.env): Promise<TurnstilePublicConfig> {
  const { data, error } = await client.from("site_config").select("turnstile_config").eq("id", 1).single();
  if (error || !data) throw new Error("TURNSTILE_CONFIG_UNAVAILABLE");
  return resolveTurnstilePublic(data.turnstile_config, env);
}

/** Call only from trusted server routes or owner checks; never serialize this result. */
export async function loadTurnstileRuntime(client: Client, env: Record<string, string | undefined> = process.env) {
  const config = await loadTurnstilePublic(client, env);
  if (config.source === "environment") return { ...config, secret: config.enabled ? env.TURNSTILE_SECRET_KEY!.trim() : null };
  if (!config.enabled) return { ...config, secret: null };
  const { data, error } = await client.from("site_secrets").select("value").eq("key", "turnstile_secret_key").maybeSingle();
  if (error || !data?.value || !validTurnstileKey(data.value)) throw new Error("TURNSTILE_SECRET_UNAVAILABLE");
  return { ...config, secret: data.value as string };
}
