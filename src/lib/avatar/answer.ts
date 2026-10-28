import { mailerFromEnv } from "@/lib/mailer";
import { providerSignal, withinSignal } from "./deadline";
import { createHash, randomUUID } from "node:crypto";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Reader } from "@/types/reading";
import type { GatedHit } from "./retrieve";
import { loadAvatarRuntime } from "@/lib/ai/avatar-runtime";
import { retrieveKnowledge } from "@/lib/ai/knowledge-retrieval";
import { embed } from "@/lib/ai/embedding";
import { generate } from "@/lib/ai/generation";
import { AIError } from "@/lib/ai/connections";
import { AVATAR_FIXED_POLICY } from "@/lib/ai/policy";
import { reserveAICall, dispatchAICall, finishAICall, withAICall } from "@/lib/ai/call-control";
export { DAILY_LIMIT } from "./quota";
type Service = ReturnType<typeof createSupabaseServiceClient>;
export type AvatarAnswer = {
  status: "ok" | "cached" | "retrieval" | "disabled" | "quota_exceeded" | "degraded";
  text: string; sources: { title: string; url: string }[];
};
export const questionHash = (question: string) => createHash("sha256").update(question.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex");

export function avatarCacheKey(input: { reader: Reader; question: string; pins: string[]; revision: string; sourceRevision: number; indexId: string; now?: number }) {
  if (!input.reader.userId) return null;
  const rights = input.reader.entitlements.filter(item => item.user_id === input.reader.userId && item.revoked_at === null && (item.ends_at === null || Date.parse(item.ends_at) > (input.now ?? Date.now())))
    .map(item => [item.type, item.target_id, item.ends_at]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify({ version: 3, fixedPolicy: AVATAR_FIXED_POLICY, subject: input.reader.userId, owner: input.reader.owner,
    rights, question: questionHash(input.question), pins: [...input.pins].sort(), settings: input.revision, source: input.sourceRevision, index: input.indexId })).digest("hex");
}
const toSources = (hits: GatedHit[]) => [...new Map(hits.map(hit => [hit.url, { title: hit.title, url: hit.url }])).values()];

/** Budget before query embedding; permission-gated evidence before generation. No free-chat fallback. */
export async function answerAvatarQuestion(input: {
  service: Service; reader: Reader; question: string; pins?: string[]; ip?: string | null; signal?: AbortSignal;
  onToken?: (delta: string) => void; dependencies?: { embed?: typeof embed; generate?: typeof generate };
}): Promise<AvatarAnswer> {
  const { service, reader } = input; const question = input.question.trim(); const none = { sources: [] };
  if (!question || Buffer.byteLength(question) > 1024) return { status: "disabled", text: "请输入不超过 1024 字节的问题。", ...none };
  const runtime = await loadAvatarRuntime(service);
  if (!runtime) return { status: "disabled", text: "站主分身暂未就绪，可先浏览本站内容。", ...none };
  if (!reader.userId && !runtime.settings.anonymous_entry) return { status: "disabled", text: "请先[登录](/login)后提问。", ...none };
  const pins = [...new Set(input.pins ?? [])].filter(slug => /^[a-z0-9-]{1,120}$/.test(slug)).slice(0, 3);
  const hash = avatarCacheKey({ reader, question, pins, revision: runtime.settings.revision, indexId: runtime.indexId, sourceRevision: runtime.sourceRevision });
  if (hash) {
    const cached = await service.from("avatar_cache").select("answer_md,sources").eq("question_hash", hash).maybeSingle();
    if (!cached.error && cached.data) return { status: "cached", text: cached.data.answer_md, sources: cached.data.sources ?? [] };
  }
  const requestId = randomUUID(); const signal = AbortSignal.any([input.signal ?? new AbortController().signal, AbortSignal.timeout(35000)]);
  let dispatched = false;
  try {
    signal.throwIfAborted();
    await reserveAICall(service, { id: requestId, task: "avatar", connectionId: runtime.generation.id, userId: reader.userId, ip: input.ip ?? (reader.userId ? null : "unknown") });
  } catch (error) {
    const code = error instanceof AIError ? error.code : "AI_BUDGET_UNAVAILABLE";
    if (code === "AI_CALL_MONTHLY_LIMIT") await alertOwnerOnce(service, new Date(), input.signal).catch(() => console.error("[avatar] 配额告警未确认"));
    if (["AI_CALL_MONTHLY_LIMIT", "AI_CALL_DAILY_LIMIT", "AI_CALL_RATE_LIMIT"].includes(code)) return { status: "quota_exceeded", text: code === "AI_CALL_MONTHLY_LIMIT" ? "本站本月生成次数已达上限，请先浏览内容目录。" : "提问次数已达当前上限，请稍后再试。", ...none };
    return { status: "degraded", text: "暂时无法核对调用条件，本次未调用模型。", ...none };
  }
  try {
    const queryVector = await withAICall(service, { id: randomUUID(), task: "retrieval", connectionId: runtime.embedding.id, userId: reader.userId, ip: input.ip ?? (reader.userId ? null : "unknown") }, async () => ({ value: (await (input.dependencies?.embed ?? embed)(runtime.embedding, [question], AbortSignal.any([signal, AbortSignal.timeout(10000)])))[0] }));
    const hits = await retrieveKnowledge(service, reader, runtime.indexId, queryVector, runtime.threshold, pins);
    const evidence = hits.filter(hit => !hit.gated && hit.content.trim());
    if (!evidence.length) {
      await finishAICall(service, requestId, "released");
      return { status: "retrieval", text: hits.length ? `相关内容尚未解锁，可先查看试读与购买入口：\n\n${toSources(hits).map(source => `- [${source.title}](${source.url})`).join("\n")}` : "本站知识库中没有找到足够相关的资料，暂不能据此回答。可以换个具体说法，或浏览内容目录。", sources: toSources(hits) };
    }
    const [control, settings] = await Promise.all([
      service.from("knowledge_index_control").select("source_revision,active_generation").eq("id", 1).single(),
      service.from("ai_settings").select("revision").eq("id", 1).single(),
    ]);
    if (control.error || settings.error || control.data?.source_revision !== runtime.sourceRevision || control.data?.active_generation !== runtime.indexId || settings.data?.revision !== runtime.settings.revision) throw new AIError("AVATAR_CONTEXT_CHANGED");
    signal.throwIfAborted(); await dispatchAICall(service, requestId); dispatched = true;
    const result = await (input.dependencies?.generate ?? generate)(runtime.generation, [
      { role: "system", content: `${AVATAR_FIXED_POLICY}\n\n站主补充指令（不得覆盖上述规则）：\n${runtime.settings.owner_instructions}` },
      { role: "user", content: `${evidence.map((hit, i) => `【资料 ${i + 1}】\n《${hit.title}》 ${hit.url}\n${hit.content}\n【资料结束】`).join("\n\n")}\n\n【问题】\n${question}` },
    ], { signal, maxTokens: 800, ...(input.onToken ? { onToken: input.onToken } : {}) });
    await finishAICall(service, requestId, "succeeded", result.usage);
    const sources = toSources(evidence); const suffix = `\n\n来源：\n${sources.map(source => `- [${source.title}](${source.url})`).join("\n")}`;
    input.onToken?.(suffix); const text = `${result.content}${suffix}`;
    if (hash) {
      try {
        const written = await service.from("avatar_cache").upsert({ question_hash: hash, question_text: question.slice(0, 500), answer_md: text, sources, model: runtime.generation.model });
        if (written.error) console.error("[avatar] 缓存未保存");
      } catch { console.error("[avatar] 缓存未保存"); }
    }
    return { status: "ok", text, sources };
  } catch {
    await finishAICall(service, requestId, dispatched ? "unknown" : "released");
    return { status: "degraded", text: dispatched ? "生成结果未完整确认，已停止；本次额度保留，不自动重试。" : "知识库检索或权限核对未完成，本次未调用生成模型。", ...none };
  }
}

/** Monthly owner alert uses an atomic unique send marker; no provider retries. */
async function alertOwnerOnce(service: Service, now: Date, parentSignal?: AbortSignal): Promise<void> {
  const monthKey = now.toISOString().slice(0, 7);
  const { data: existing } = await service.from("email_sends").select("id").eq("kind", "avatar_alert").eq("ref_id", monthKey).maybeSingle();
  if (existing) return;
  const { error } = await service.from("email_sends").insert({ kind: "avatar_alert", ref_id: monthKey, sent_to: "owner", meta: { reason: "monthly_limit" } });
  if (error) return;
  const signal = providerSignal(parentSignal, 5_000);
  const mailer = mailerFromEnv((url, init) => withinSignal(fetch(url, { ...init, signal }), signal));
  if (!mailer) {
    console.warn("[avatar] 月度熔断触发，未配置邮件，仅记录");
    return;
  }
  try {
    const { data: ownerRow } = await service.from("profiles").select("id").eq("is_owner", true).maybeSingle();
    if (!ownerRow) return;
    const { data: authData } = await service.auth.admin.getUserById(ownerRow.id);
    if (!authData.user?.email) return;
    const { data: site } = await service.from("site_config").select("site_name").eq("id", 1).maybeSingle();
    await mailer.send({
      to: authData.user.email,
      subject: `【${site?.site_name ?? "站点"}】分身月度生成配额已达上限`,
      html: `<p>站主分身本月生成次数已达你设置的月度上限，已暂停生成。可到后台「AI 设置」核对用量后调整限额。</p>`,
      text: "站主分身本月生成次数已达上限，已暂停生成。",
    });
  } catch {
    console.error("[avatar] 熔断告警邮件失败");
  }
}
