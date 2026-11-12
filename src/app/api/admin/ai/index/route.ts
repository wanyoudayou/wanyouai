import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { AIError, object } from "@/lib/ai/connections";
import { providerJSON } from "@/lib/ai/transport";
import { knowledgeRPC, knowledgeStatus, runKnowledgeStep } from "@/lib/ai/knowledge";
import { evaluationCases, evaluationDetail, finishEvaluation, knowledgeBaseline, runEvaluationStep, validateEvaluationSources } from "@/lib/ai/knowledge-evaluation";
import { beginQuestionDraft, questionDraft, questionPlan, stepQuestionDraft } from "@/lib/ai/knowledge-questions";
import { previewKnowledgeAnswer } from "@/lib/ai/knowledge-answer-preview";

export const runtime = "nodejs";
export const maxDuration = 60;
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const messages: Record<string, string> = {
  KNOWLEDGE_SOURCE_CHANGED: "内容已变化，旧结果不会投入使用。请刷新状态，确认新增内容的发送范围后继续。",
  KNOWLEDGE_CONNECTION_UNVERIFIED: "请先保存并检查知识库向量连接。",
  KNOWLEDGE_EMPTY: "暂无可索引的已发布内容，请先发布文章或载入使用指南。",
  KNOWLEDGE_BUILD_EXISTS: "已有待切换的构建，请继续或移除该任务。",
  KNOWLEDGE_MANUAL_RETRY_REQUIRED: "有未确认的外部调用，已停止。确认可能重复计费后，才能手动重试失败项。",
  KNOWLEDGE_INCOMPLETE: "索引尚未完整就绪，请先完成构建。",
  KNOWLEDGE_EVALUATION_REQUIRED: "请刷新页面，完成索引后由站主确认启用。",
  KNOWLEDGE_ACCEPTANCE_REQUIRED: "请在当前页面确认启用知识库；问题测试可以跳过。",
  KNOWLEDGE_EVALUATION_BALANCE_REQUIRED: "可以准备任意 1–100 个问题，无需分组。",
  KNOWLEDGE_EVALUATION_CASES_REQUIRED: "请提供 1–100 个不重复的检查问题。",
  KNOWLEDGE_ANSWERS_UNREVIEWED: "请逐题确认答案来源，尚未核对的问题不能开始预演。",
  KNOWLEDGE_GENERATION_CONNECTION_REQUIRED: "自动出题与回答预演需要先保存并检查生成连接；也可以手工准备检查问题。",
  KNOWLEDGE_QUESTION_OUTPUT_INVALID: "模型未返回符合要求的问题草稿，已停止且不会自动重试；已完成的批次仍保留。",
  KNOWLEDGE_DRAFT_BUSY: "出题请求仍在执行，请稍后读取进度，不重复发送。",
  KNOWLEDGE_DRAFT_UNAVAILABLE: "问题草稿暂不可读，请先刷新，不要重新生成。",
  KNOWLEDGE_SETTINGS_CHANGED: "AI 配置已变化，本次许可已失效。请刷新页面核对当前配置后重新确认。",
  KNOWLEDGE_EVALUATION_CASE_INVALID: "评测问题格式无效、重复或过长，请参照示例格式修改。",
  KNOWLEDGE_TRAIN_RECALL_FAILED: "训练问题未找到预期来源。请检查来源标识、内容及分片，保留失败样例后修正。",
  KNOWLEDGE_TRAIN_SEPARATION_FAILED: "训练集中有答案与无答案问题的相关性无法区分，可作为诊断参考，不影响站主决定启用。",
  KNOWLEDGE_REBUILD_REQUIRED: "向量连接已变化，请选择全量重建，不混用原索引的向量。",
  KNOWLEDGE_ALREADY_INITIALIZED: "已有正在使用的索引，请选择同步内容变化或全量重建。",
  KNOWLEDGE_INITIALIZE_REQUIRED: "还没有正在使用的索引，请先初始化。",
  KNOWLEDGE_EVALUATION_SOURCE_MISSING: "部分预期来源未发布、已失效或不存在，请重新选择本站有效来源。",
};

export async function GET(request: Request) {
  const identity = await getAdminIdentity();
  if (!identity.owner || !identity.user) return response({ message: "需要站主身份。" }, 401);
  try {
    const service = createSupabaseServiceClient({ timeoutMs: 6000 });
    const params = new URL(request.url).searchParams;
    if (["draft", "baseline", "question_plan"].includes(params.get("resource") ?? "")) {
      const id = params.get("id"); if (!uuid(id)) return response({ message: "索引标识无效。" }, 400);
      if (params.get("resource") === "question_plan") return response({ plan: await questionPlan(service, id) });
      return params.get("resource") === "draft" ? response({ draft: await questionDraft(service, id) }) : response({ baseline: await knowledgeBaseline(service, id) });
    }
    if (params.get("resource") === "sources") {
      const query = params.get("q") ?? "";
      if (query.length > 120) return response({ message: "搜索词最多 120 个字符。" }, 400);
      return response({ sources: await knowledgeRPC(service, "knowledge_source_choices", { p_query: query }) });
    }
    if (params.get("resource") === "evaluation") {
      const id = params.get("id");
      if (!uuid(id)) return response({ message: "验收标识无效。" }, 400);
      return response({ evaluation: await evaluationDetail(service, id) });
    }
    return response({ status: await knowledgeStatus(service) });
  }
  catch (error) {
    const code = error instanceof AIError ? error.code : "KNOWLEDGE_STATUS_UNAVAILABLE";
    return response({ code, message: messages[code] ?? "知识库状态暂时无法读取，不代表零条或已完成。" }, messages[code] ? 409 : 503);
  }
}

export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return response({ message: "请求来源无效。" }, 403);
  const identity = await getAdminIdentity();
  if (!identity.owner || !identity.user) return response({ message: "需要站主身份。" }, 401);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
  try {
    const input = object(await providerJSON(new Response(request.body), signal, 180000));
    const action = input.action;
    if (!["start", "resume", "step", "retry", "evaluation_start", "evaluation_step", "evaluation_finish", "evaluation_retry", "questions_start", "questions_step", "questions_retry", "answer_preview", "activate", "discard"].includes(String(action))) return response({ message: "操作无效。" }, 400);
    if (action !== "start" && !uuid(input.id)) return response({ message: "任务标识无效。" }, 400);
    const service = createSupabaseServiceClient({ signal, timeoutMs: 6000 });
    if (action === "questions_start") {
      if (input.consent !== true || !uuid(input.requestId) || !uuid(input.connectionId) || !Number.isSafeInteger(input.sourceRevision)) return response({ message: "请确认内容范围及出题费用。" }, 400);
      return response({ draft: await beginQuestionDraft(service, String(input.id), input.requestId, Number(input.sourceRevision), input.connectionId) });
    }
    if (action === "questions_step" || action === "questions_retry") {
      if (action === "questions_retry" && input.consent !== true) return response({ message: "请确认可能重复计费后再重试。" }, 400);
      return response({ draft: await stepQuestionDraft(service, String(input.id), identity.user.id, signal, action === "questions_retry") });
    }
    if (action === "answer_preview") {
      if (input.consent !== true || !uuid(input.requestId) || !uuid(input.settingsRevision) || !Number.isSafeInteger(input.questionIndex) || !["anonymous", "owner"].includes(String(input.view))) return response({ message: "请确认预演视角及调用费用。" }, 400);
      return response({ preview: await previewKnowledgeAnswer(service, String(input.id), Number(input.questionIndex), identity.user.id, input.view === "owner", input.requestId, signal, input.settingsRevision) });
    }
    let id = input.id; let result: unknown;
    if (action === "start" || action === "resume") {
      if (!Number.isSafeInteger(input.sourceRevision) || !uuid(input.connection)) return response({ message: "请刷新并核对知识库发送范围。" }, 409);
      id = action === "start"
        ? await knowledgeRPC(service, "start_knowledge_task", { p_owner: identity.user.id, p_mode: input.mode, p_consent: input.consent === true, p_revision: input.sourceRevision, p_connection: input.connection })
        : await knowledgeRPC(service, "begin_knowledge_index", { p_owner: identity.user.id, p_consent: input.consent === true, p_expected_revision: input.sourceRevision, p_expected_connection: input.connection, p_generation: id });
    }
    if (action === "step") result = await runKnowledgeStep(service, String(id), signal);
    if (action === "retry") await knowledgeRPC(service, "retry_knowledge_failures", { p_owner: identity.user.id, p_generation: id, p_confirm_unknown: input.consent === true });
    if (action === "evaluation_start") {
      const cases = evaluationCases(input.cases);
      await validateEvaluationSources(service, cases);
      id = await knowledgeRPC(service, "begin_knowledge_evaluation", { p_owner: identity.user.id, p_generation: id, p_cases: cases, p_consent: input.consent === true });
    }
    if (action === "evaluation_step") await runEvaluationStep(service, String(id), signal);
    if (action === "evaluation_finish") result = await finishEvaluation(service, String(id));
    if (action === "evaluation_retry") await knowledgeRPC(service, "retry_knowledge_evaluation", { p_owner: identity.user.id, p_run: id, p_confirm_unknown: input.consent === true });
    if (action === "activate") {
      if (input.accept !== true || !Number.isSafeInteger(input.sourceRevision) || !uuid(input.connection)) return response({ message: "请确认启用，并核对当前内容与连接。" }, 400);
      await knowledgeRPC(service, "enable_knowledge_index", { p_owner: identity.user.id, p_generation: id, p_revision: input.sourceRevision, p_connection: input.connection, p_confirm: true });
    }
    if (action === "discard") await knowledgeRPC(service, "discard_knowledge_generation", { p_owner: identity.user.id, p_generation: id });
    return response({ id, result, status: await knowledgeStatus(service) });
  } catch (error) {
    const code = error instanceof AIError ? error.code : "KNOWLEDGE_OPERATION_INTERRUPTED";
    return response({ code, message: messages[code] ?? `本次操作未确认（${code}），已停止且不会自动重试。请刷新查看保存状态。` }, 409);
  }
}
