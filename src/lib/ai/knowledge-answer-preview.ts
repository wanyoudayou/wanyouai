import type { createSupabaseServiceClient } from "../supabase/service";
import { AIError } from "./connections";
import { evaluationDetail } from "./knowledge-evaluation";
import { loadAIConnection, loadAISettings } from "./settings";
import { knowledgeStatus } from "./knowledge";
import { indexComplete } from "./knowledge-workflow";
import { embed } from "./embedding";
import { generate } from "./generation";
import { retrieveKnowledge } from "./knowledge-retrieval";
import { withAICall } from "./call-control";
import { AVATAR_FIXED_POLICY } from "./policy";

type Service = ReturnType<typeof createSupabaseServiceClient>;
/** Owner-only preview. A simulated reader affects gating, never grants real rights. */
export async function previewKnowledgeAnswer(service: Service, runId: string, questionIndex: number, ownerId: string, ownerView: boolean, requestId: string, signal: AbortSignal,
  expectedSettingsRevision: string, dependencies: { embed?: typeof embed; generate?: typeof generate } = {}) {
  const [detail, status, settings] = await Promise.all([evaluationDetail(service, runId), knowledgeStatus(service), loadAISettings(service)]);
  const candidate = status.generations.find(item => item.id === detail.generationId);
  if (settings.revision !== expectedSettingsRevision) throw new AIError("KNOWLEDGE_SETTINGS_CHANGED");
  if (!candidate || !indexComplete(status, candidate) || detail.sourceRevision !== status.sourceRevision || detail.state !== "complete" || detail.report?.threshold === undefined) throw new AIError("KNOWLEDGE_EVALUATION_INCOMPLETE");
  if (!Number.isSafeInteger(questionIndex) || !detail.cases[questionIndex]) throw new AIError("KNOWLEDGE_EVALUATION_CASE_INVALID");
  if (!settings.generation_connection || candidate.connectionId !== status.selectedConnection) throw new AIError("KNOWLEDGE_GENERATION_CONNECTION_REQUIRED");
  const [generation, embedding] = await Promise.all([loadAIConnection(service, settings.generation_connection), loadAIConnection(service, candidate.connectionId)]);
  if (!generation.verifiedAt || !embedding.verifiedAt) throw new AIError("KNOWLEDGE_CONNECTION_UNVERIFIED");
  const question = detail.cases[questionIndex].question;
  const vector = await withAICall(service, { id: requestId, task: "knowledge_preview_retrieval", connectionId: embedding.id, userId: ownerId }, async () => ({ value: (await (dependencies.embed ?? embed)(embedding, [question], signal))[0] }));
  const hits = await retrieveKnowledge(service, { owner: ownerView, userId: ownerView ? ownerId : null, entitlements: [] }, candidate.id, vector, detail.report.threshold);
  const evidence = hits.filter(item => !item.gated && item.content.trim());
  const sources = [...new Map(hits.map(item => [item.url, { title: item.title, url: item.url }])).values()];
  if (!evidence.length) return { text: hits.length ? "当前预演视角没有权限读取相关正文，只能查看试读与购买入口。" : "本站知识库中没有足够相关的资料，分身不会调用生成模型作答。", sources, generated: false };
  const [latest, currentSettings] = await Promise.all([knowledgeStatus(service), loadAISettings(service)]);
  if (latest.sourceRevision !== status.sourceRevision || settings.revision !== currentSettings.revision) throw new AIError("KNOWLEDGE_SOURCE_CHANGED");
  const result = await withAICall(service, { id: crypto.randomUUID(), task: "knowledge_preview", connectionId: generation.id, userId: ownerId }, async () => {
    const result = await (dependencies.generate ?? generate)(generation, [
      { role: "system", content: `${AVATAR_FIXED_POLICY}\n\n站主补充指令（不得覆盖上述规则）：\n${settings.owner_instructions}` },
      { role: "user", content: `${evidence.map((item, i) => `【资料 ${i + 1}】\n《${item.title}》 ${item.url}\n${item.content}\n【资料结束】`).join("\n\n")}\n\n【问题】\n${question}` },
    ], { signal, maxTokens: 800 });
    return { value: result.content, usage: result.usage };
  });
  return { text: result, sources: [...new Map(evidence.map(item => [item.url, { title: item.title, url: item.url }])).values()], generated: true };
}
