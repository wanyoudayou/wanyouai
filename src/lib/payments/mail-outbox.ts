// Pure, injected worker. Service credentials and HTTP authorization live in the server adapter/route.
import { createHash } from "node:crypto";
import { escapeHtml, renderMailHtml } from "../mailer";

export type GrantMessage = { from: string; to: string; subject: string; html: string; text: string };
export type MailJob = {
  id: string; lease_token: string; lease_until: string; attempts: number;
  snapshot: { version: number; user_id: string; order_id: number; site_name: string; description: string; ends_at: string | null };
  message: GrantMessage | null; provider_fingerprint: string | null; started_at: string | null;
};
export type MailHealth = { pending: number; processing: number; sent: number; dead: number; oldest_due_seconds: number };
export type MailCode = "network" | "provider_retry" | "provider_rejected" | "invalid_response" | "config_changed" | "recipient_missing" | "preparation_failed" | "window_expired" | "attempts_exhausted";
export type Delivery = { outcome: "sent"; providerId: string } | { outcome: "retry" | "dead"; code: MailCode; providerStatus?: number };
export type MailConfig = { apiKey: string; from: string; siteUrl: string; fingerprint: string };
export function parseMailHealth(value: unknown): MailHealth {
  if (!value || typeof value !== "object") throw new Error("Invalid mail health");
  const data = value as Record<string, unknown>;
  for (const key of ["pending", "processing", "sent", "dead", "oldest_due_seconds"])
    if (typeof data[key] !== "number" || !Number.isFinite(data[key]) || Number(data[key]) < 0) throw new Error("Invalid mail health");
  return { pending: Number(data.pending), processing: Number(data.processing), sent: Number(data.sent), dead: Number(data.dead), oldest_due_seconds: Number(data.oldest_due_seconds) };
}
export type OutboxGateway = {
  claim(): Promise<MailJob | null>;
  recipient(userId: string): Promise<string | null>;
  prepare(job: MailJob, message: GrantMessage, fingerprint: string): Promise<MailJob>;
  finish(job: MailJob, delivery: Delivery): Promise<boolean>;
  health(): Promise<MailHealth>;
};

export function outboxConfig(env: Record<string, string | undefined>): MailConfig | null {
  const apiKey = env.RESEND_API_KEY?.trim(), from = env.EMAIL_FROM?.trim(), siteUrl = env.SITE_URL?.trim();
  if (!apiKey || !from || !siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { apiKey, from, siteUrl: url.origin, fingerprint: createHash("sha256").update(apiKey).digest("hex") };
  } catch { return null; }
}

export function renderGrantMessage(job: MailJob, to: string, config: MailConfig): GrantMessage {
  const { site_name: siteName, order_id: orderId, description, ends_at: endsAt } = job.snapshot;
  if (job.snapshot.version !== 1) throw new Error("Unsupported mail snapshot");
  const validity = endsAt ? `有效期至 ${new Date(endsAt).toISOString().slice(0, 10)}` : "永久有效";
  const ctaUrl = `${config.siteUrl}/me`;
  return {
    from: config.from, to,
    subject: `【${siteName}】权益已开通：${description}`,
    html: renderMailHtml({ siteName, title: "权益已开通", bodyHtml: `<p>你的订单 #${orderId} 已支付成功，对应权益已开通。</p>`,
      summary: `权益摘要：${escapeHtml(description)} · ${escapeHtml(validity)}`, ctaUrl, ctaLabel: "查看我的权益" }),
    text: `【${siteName}】订单 #${orderId} 已支付成功，权益已开通：${description} · ${validity}。查看我的权益：${ctaUrl}`,
  };
}

/** Resend stores idempotency keys for 24h. The DB/worker stop automatic replay at 23h. */
export async function deliverGrant(config: MailConfig, job: MailJob, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Delivery> {
  if (!job.message) return { outcome: "dead", code: "preparation_failed" };
  if (job.provider_fingerprint !== config.fingerprint) return { outcome: "dead", code: "config_changed" };
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", "Idempotency-Key": `grant/${job.id}` },
      body: JSON.stringify({ ...job.message, to: [job.message.to] }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        const body = await response.json().catch(() => null);
        return body?.name === "concurrent_idempotent_requests"
          ? { outcome: "retry", code: "provider_retry", providerStatus: response.status }
          : { outcome: "dead", code: "provider_rejected", providerStatus: response.status };
      }
      return response.status === 429 || response.status >= 500
        ? { outcome: "retry", code: "provider_retry", providerStatus: response.status }
        : { outcome: "dead", code: "provider_rejected", providerStatus: response.status };
    }
    const body = await response.json().catch(() => null);
    return typeof body?.id === "string" && body.id.trim().length > 0 && body.id.length <= 256
      ? { outcome: "sent", providerId: body.id } : { outcome: "retry", code: "invalid_response" };
  } catch { return { outcome: "retry", code: "network" }; }
}

export async function runMailOutbox(gateway: OutboxGateway, config: MailConfig | null, options: {
  deliver?: typeof deliverGrant; now?: () => number; budgetMs?: number; signal?: AbortSignal;
} = {}) {
  const summary = { claimed: 0, sent: 0, retry: 0, dead: 0, leaseLost: 0 };
  if (!config) return { enabled: false, summary, health: null };
  const now = options.now ?? Date.now, deadline = now() + (options.budgetMs ?? 45000);
  for (let i = 0; i < 5 && deadline - now() >= 35000 && !options.signal?.aborted; i++) {
    let job = await gateway.claim();
    if (!job) break;
    summary.claimed++;
    let delivery: Delivery | undefined;
    if (!job.message) {
      try {
        const email = await gateway.recipient(job.snapshot.user_id);
        if (!email) delivery = { outcome: "dead", code: "recipient_missing" };
        else job = await gateway.prepare(job, renderGrantMessage(job, email, config), config.fingerprint);
      } catch { delivery = { outcome: "retry", code: "preparation_failed" }; }
    }
    if (!delivery) {
      if (!job.started_at || !Number.isFinite(Date.parse(job.started_at)) || now() - Date.parse(job.started_at) >= 23 * 3600_000)
        delivery = { outcome: "dead", code: "window_expired" };
      else if (options.signal?.aborted || deadline - now() < 18000 || !Number.isFinite(Date.parse(job.lease_until)) || Date.parse(job.lease_until) - now() < 18000)
        delivery = { outcome: "retry", code: "network" };
      else delivery = await (options.deliver ?? deliverGrant)(config, job, fetch, options.signal);
    }
    if (delivery.outcome === "retry" && job.attempts >= 8) delivery = { outcome: "dead", code: "attempts_exhausted" };
    else if (delivery.outcome === "retry" && job.started_at && now() - Date.parse(job.started_at) >= 23 * 3600_000)
      delivery = { outcome: "dead", code: "window_expired" };
    // An unavailable acknowledgement leaves the lease recoverable; never pretend delivery was recorded.
    if (await gateway.finish(job, delivery)) summary[delivery.outcome]++;
    else summary.leaseLost++;
  }
  return { enabled: true, summary, health: await gateway.health() };
}
