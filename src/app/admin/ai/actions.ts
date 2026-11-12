"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AIError, connectionDefinition, validAPIKey } from "@/lib/ai/connections";
import { aiSettingsView, loadAISettings, type AISettingsView } from "@/lib/ai/settings";
import { DEFAULT_AVATAR_INSTRUCTIONS } from "@/lib/ai/policy";

export type AISettingsResult = { message: string; view?: AISettingsView };
export async function saveAISettings(form: FormData): Promise<AISettingsResult> {
  try {
    const identity = await getAdminIdentity();
    if (!identity.owner || !identity.user) return { message: "需要站主身份。" };
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const generation = form.get("generation_enabled") === "on" ? connectionDefinition({ purpose: "generation", protocol: text("generation_protocol"), baseUrl: text("generation_base_url"), model: text("generation_model") }) : null;
    const embedding = form.get("embedding_enabled") === "on" ? connectionDefinition({ purpose: "embedding", protocol: "embeddings", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3" }) : null;
    const generationKey = generation ? text("generation_key") : "";
    const embeddingKey = embedding ? text("embedding_key") : "";
    const instructions = text("owner_instructions");
    const limit = text("monthly_limit");
    if ((generationKey && !validAPIKey(generationKey)) || (embeddingKey && !validAPIKey(embeddingKey)) || instructions.length > 8000 || (limit && (!/^\d+$/.test(limit) || Number(limit) > 1000000))) return { message: "请检查密钥格式、指令长度与月度上限。输入已保留。" };
    const service = createSupabaseServiceClient();
    const { error } = await service.rpc("save_ai_settings", {
      p_owner: identity.user.id, p_expected: text("revision"), p_generation: generation, p_generation_key: generationKey,
      p_embedding: embedding, p_embedding_key: embeddingKey, p_reuse_key: !!embedding && form.get("embedding_reuse") === "on",
      p_avatar: { enabled: form.get("avatar_enabled") === "on", anonymousEntry: form.get("anonymous_entry") === "on", instructions, monthlyLimit: limit ? Number(limit) : null },
    });
    if (error) {
      if (error.message.includes("SETTINGS_CONFLICT")) return { message: "配置已被更新，本次未覆盖。请保留输入并刷新核对。" };
      if (error.message.includes("AI_TARGET_KEY_REQUIRED")) return { message: "新增连接或更换接口地址时，请填写该目标的 API Key。" };
      if (error.message.includes("AI_SHARED_KEY_TARGET_MISMATCH")) return { message: "只有同一硅基流动连接才能显式复用 Key；复用时请清空独立向量 Key 输入。" };
      throw new AIError("AI_SAVE_UNCONFIRMED");
    }
    revalidatePath("/", "layout");
    return { message: "AI 配置已保存。新连接须先检查；知识库未就绪时不开放分身。", view: await aiSettingsView(service) };
  } catch (error) {
    if (error instanceof AIError && error.code === "INVALID_CONNECTION") return { message: "请填写准确的模型标识并选择对应接口与协议。输入已保留，本次未保存。" };
    return { message: "保存结果暂时无法确认，请先刷新核对；输入内容已保留。" };
  }
}

export async function migrateLegacyAI(form: FormData): Promise<AISettingsResult> {
  try {
    const identity = await getAdminIdentity();
    if (!identity.owner || !identity.user) return { message: "需要站主身份。" };
    const service = createSupabaseServiceClient();
    const current = await loadAISettings(service);
    if (current.generation_connection || current.embedding_connection) return { message: "后台已有连接，未覆盖现有配置。" };
    const [{ data: site, error }, { data: key, error: keyError }] = await Promise.all([
      service.from("site_config").select("avatar_config").eq("id", 1).single(),
      service.from("site_secrets").select("value").eq("key", "avatar_api_key").maybeSingle(),
    ]);
    if (error || keyError) throw new AIError("LEGACY_CONFIG_UNAVAILABLE");
    const old = site?.avatar_config ?? {};
    const oldBase = process.env.AVATAR_BASE_URL?.replace(/\/$/, "") || "https://api.deepseek.com";
    if (key?.value && !old.model) return { message: "旧配置缺少模型标识，请在共享生成模型中按供应商当前模型列表填写。未迁移或发送请求。" };
    const generation = key?.value ? connectionDefinition({ purpose: "generation", protocol: "chat", baseUrl: oldBase === "https://api.deepseek.com/v1" ? "https://api.deepseek.com" : oldBase, model: old.model }) : null;
    const embedding = process.env.EMBEDDING_BASE_URL && process.env.EMBEDDING_API_KEY && process.env.EMBEDDING_MODEL
      ? connectionDefinition({ purpose: "embedding", protocol: "embeddings", baseUrl: process.env.EMBEDDING_BASE_URL, model: process.env.EMBEDDING_MODEL }) : null;
    if (!generation && !embedding) return { message: "没有可迁移的完整连接，请直接填写新配置。" };
    const result = await service.rpc("save_ai_settings", {
      p_owner: identity.user.id, p_expected: String(form.get("revision") ?? ""),
      p_generation: generation, p_generation_key: generation ? key!.value : "", p_embedding: embedding, p_embedding_key: embedding ? process.env.EMBEDDING_API_KEY! : "", p_reuse_key: false,
      p_avatar: { enabled: old.enabled === true, anonymousEntry: old.anonymous_entry === true, instructions: DEFAULT_AVATAR_INSTRUCTIONS, monthlyLimit: typeof old.monthly_limit === "number" ? old.monthly_limit : null },
    });
    if (result.error) throw new AIError("LEGACY_MIGRATION_UNCONFIRMED");
    revalidatePath("/", "layout");
    return { message: "已迁入后台；未发送文章、检查连接或开启知识库。后续只使用后台配置。", view: await aiSettingsView(service) };
  } catch { return { message: "迁移未确认。请核对受支持的接口与 1024 维模型，刷新确认后再操作。" }; }
}
