import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { loadAISettings, loadAIConnection } from "@/lib/ai/settings";
import { withAICall } from "@/lib/ai/call-control";
import type { AIMessage } from "@/lib/ai/generation";
import { withinSignal } from "@/lib/avatar/deadline";
import { canUseSkill } from "./access";
import { readSkillPackage, readSkillRelease } from "./storage";
import { runTextSkill } from "./runner";
import { skillTurnFailure } from "./diagnostics";
import { SkillError } from "./types";

async function authorizeOnline(skill: number, user: string) {
  if (!await canUseSkill(skill, user)) throw new SkillError("当前账户不再具备此 Skill 的使用权限。", 403);
  const result = await createSupabaseServiceClient().from("skills").select("online_enabled").eq("id", skill).single();
  if (result.error || !result.data?.online_enabled) throw new SkillError("此 Skill 的在线对话暂未启用。", 403);
}
export async function skillConversation(user: string, skill: number, session: string) {
  const db = createSupabaseServiceClient();
  const result = await db.from("skill_sessions").select("id,release_id").eq("id", session).eq("user_id", user).maybeSingle();
  if (result.error || !result.data) throw new SkillError("对话不存在或暂时不可读。", 404);
  const release = await readSkillRelease(result.data.release_id);
  if (release.skill_id !== skill) throw new SkillError("对话不属于此 Skill。", 403);
  await authorizeOnline(skill, user);
  const turns = await db.from("skill_turns").select("id,question,answer,state,lease_until,created_at").eq("session_id", session).order("created_at").order("id").limit(30);
  if (turns.error) throw new SkillError("对话记录暂时不可读。", 503);
  return { session, version: release.version, turns: turns.data.map(t => ({ id: t.id, question: t.question, answer: t.answer, state: t.state === "running" && Date.parse(t.lease_until) < Date.now() ? "unknown" : t.state })) };
}
export async function submitSkillTurn(input: { user: string; skill: number; session: string; id: string; question: string; signal?: AbortSignal }) {
  const signal = AbortSignal.any([AbortSignal.timeout(45000), ...(input.signal ? [input.signal] : [])]);
  const db = createSupabaseServiceClient({ timeoutMs: 10000 });
  const begin = await db.rpc("begin_skill_turn", { p_user: input.user, p_skill: input.skill, p_session: input.session, p_request: input.id, p_question: input.question });
  if (begin.error || !begin.data) throw new SkillError(begin.error?.message.includes("SESSION_FULL") ? "此对话已达到 30 轮，请新建对话。" : "对话无法开始：请确认使用权限，或等待上一轮结束。", 409);
  if (!begin.data.new) return { id: input.id, state: begin.data.state, answer: begin.data.answer };
  let dispatched = false;
  const callIds: string[] = [];
  try {
    const answer = await withinSignal((async () => {
      const release = await readSkillRelease(begin.data.release);
      const settings = await loadAISettings(db);
      if (!settings.generation_connection) throw new SkillError("请站主先在 AI 设置中配置模型连接。");
      const connection = await loadAIConnection(db, settings.generation_connection);
      if (!connection.verifiedAt) throw new SkillError("模型连接尚未通过连接检查。");
      await authorizeOnline(input.skill, input.user);
      const inspected = await readSkillPackage(release);
      const previous = await db.from("skill_turns").select("question,answer").eq("session_id", input.session).eq("state", "succeeded").order("created_at").order("id").limit(30);
      if (previous.error) throw new SkillError("对话历史暂时无法读取。");
      const history: AIMessage[] = previous.data.flatMap(t => [{ role: "user" as const, content: t.question }, { role: "assistant" as const, content: JSON.stringify({ answer: t.answer }) }]);
      return runTextSkill({ connection, texts: inspected.texts, history, question: input.question, signal,
        authorize: () => authorizeOnline(input.skill, input.user),
        call: operation => {
          const id = randomUUID(); callIds.push(id);
          return withAICall(db, { id, task: "skill", connectionId: connection.id, userId: input.user }, async () => { signal.throwIfAborted(); dispatched = true; const result = await operation(); return { value: result, usage: result.usage }; });
        },
      });
    })(), signal);
    await authorizeOnline(input.skill, input.user);
    const saved = await db.from("skill_turns").update({ answer, state: "succeeded" }).eq("id", input.id).eq("session_id", input.session).eq("state", "running").select("id");
    if (saved.error || !saved.data?.length) throw new SkillError("回答保存结果未知，请查询本轮状态。");
    return { id: input.id, state: "succeeded", answer };
  } catch (error) {
    const failure = skillTurnFailure(error, { turnId: input.id, callIds, dispatched, signal });
    await db.from("skill_turns").update({ state: dispatched ? "unknown" : "failed" }).eq("id", input.id).eq("session_id", input.session).eq("state", "running");
    throw failure;
  }
}
