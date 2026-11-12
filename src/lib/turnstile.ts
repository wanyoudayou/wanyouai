import { withinSignal } from "./avatar/deadline";

export function turnstileFromConfig(config: { enabled: boolean; secret: string | null }, hostname: string, action: "avatar" | "inquiry", fetchImpl: typeof fetch = fetch) {
  if (!config.enabled || !config.secret) return null;
  return {
    async verify(token: string, ip?: string | null): Promise<boolean> {
      if (!token || token.length > 2048 || !hostname) return false;
      const signal = AbortSignal.timeout(5000);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const body = new URLSearchParams({ secret: config.secret!, response: token, ...(ip ? { remoteip: ip } : {}) });
        const response = await withinSignal(fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST", body, redirect: "error", signal,
        }), signal);
        if (!response.ok || !response.body) { void response.body?.cancel().catch(() => {}); return false; }
        reader = response.body.getReader();
        const parts: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const part = await withinSignal(reader.read(), signal);
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 8192) return false;
          parts.push(part.value);
        }
        const data = JSON.parse(Buffer.concat(parts).toString("utf8"));
        return data.success === true && data.hostname === hostname && data.action === action;
      } catch { return false; }
      finally { if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); } }
    },
  };
}

export function turnstileHostname(env: Record<string, string | undefined> = process.env) {
  try { return new URL(env.SITE_URL ?? "").hostname; } catch { return ""; }
}
