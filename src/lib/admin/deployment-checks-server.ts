import "server-only";
import manifest from "../../../supabase/release-manifest.json";
import { getAdminIdentity } from "./session";
import { createSupabaseServiceClient } from "../supabase/service";
import { inspectStorage, storageTargets } from "../config/storage.mjs";
import { inspectDeployment } from "./deployment-checks";
import { parseMailHealth } from "../payments/mail-outbox";
import { loadTurnstileRuntime } from "../turnstile-config";
import { inspectConfig } from "../config/registry.mjs";
import { loadAISettings } from "../ai/settings";
import { knowledgeStatus } from "../ai/knowledge";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export async function getDeploymentReport() {
  // Created lazily: a non-owner can never create the service client, even through this data function.
  let service: ReturnType<typeof createSupabaseServiceClient> | undefined;
  const client = () => service ??= createSupabaseServiceClient({ timeoutMs: 8000 });
  return inspectDeployment({
    async isOwner() { return (await getAdminIdentity()).owner; },
    env() { return process.env; },
    async schemaVersion() {
      const { data, error } = await client().from("app_schema_version").select("version").eq("id", 1).single();
      if (error || !data) throw new Error();
      return data.version;
    },
    async site() {
      const { data, error } = await client().from("site_config").select("site_name,owner_name,identity,commerce,avatar_config").eq("id", 1).single();
      if (error || !data) throw new Error();
      const identity = object(data.identity), commerce = object(data.commerce);
      const ai = await loadAISettings(client());
      return {
        identityReady: text(data.site_name) && data.site_name !== "我的站点" && text(data.owner_name) && data.owner_name !== "站主（待配置）" && text(identity.one_liner) && identity.one_liner !== "站点初始化完成，请站主配置名片",
        paymentEnabled: commerce.payment_enabled === true,
        paymentChannelsReady: Array.isArray(commerce.payment_channels) && commerce.payment_channels.length > 0 && commerce.payment_channels.every((channel) => ["alipay", "wxpay"].includes(channel)),
        avatarEnabled: ai.avatar_enabled,
        avatarModelReady: false,
      };
    },
    async aiStatus() {
      const [settings, status] = await Promise.all([loadAISettings(client()), knowledgeStatus(client())]);
      const active = status.generations.find(item => item.id === status.activeGeneration);
      const ids = [settings.generation_connection, settings.embedding_connection, active?.connectionId].filter((id): id is string => !!id);
      const result = ids.length ? await client().from("ai_connections").select("id,verified_at").in("id", ids) : { data: [], error: null };
      if (result.error || !result.data) throw new Error();
      const verified = new Set(result.data.filter(row => row.verified_at).map(row => row.id));
      const generation = !settings.generation_connection ? "disabled" : verified.has(settings.generation_connection) ? "ready" : "incomplete";
      const embedding = !settings.embedding_connection ? "disabled" : verified.has(settings.embedding_connection) ? "ready" : "incomplete";
      const knowledge = active?.counts.ready && active.threshold !== null && verified.has(active.connectionId) ? "ready" : settings.embedding_connection ? "incomplete" : "disabled";
      return { generation, embedding, knowledge, avatar: !settings.avatar_enabled ? "disabled" : generation === "ready" && knowledge === "ready" && settings.embedding_connection ? "ready" : "incomplete" };
    },
    async turnstileStatus() {
      const config = await loadTurnstileRuntime(client());
      if (config.source === "environment") return inspectConfig(process.env).find(check => check.id === "turnstile")!.status;
      return config.enabled ? "ready" : "disabled";
    },
    async mediaReady() {
      const result = await inspectStorage(client().storage, storageTargets(process.env));
      return result.every((check) => check.status === "ready");
    },
    async hasPublishedContent() {
      const { count, error } = await client().from("articles").select("id", { head: true, count: "exact" }).eq("status", "published");
      if (error || count === null) throw new Error();
      return count > 0;
    },
    async mailQueue() {
      const { data, error } = await client().rpc("email_outbox_health");
      if (error || !data) throw new Error();
      return parseMailHealth(data);
    },
  }, manifest.schema_version);
}
