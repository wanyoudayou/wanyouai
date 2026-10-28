"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 收件箱处理：标记留言已处理（owner RLS 限定）。 */
export async function resolveInboxItem(_previous: { message: string }, form: FormData) {
  if (!(await getAdminIdentity()).owner) return { message: "需要站主身份" };
  const id = String(form.get("id") ?? "");
  if (!/^\d+$/.test(id)) return { message: "参数无效" };
  const client = await createSupabaseServerClient();
  const { error } = await client.from("inbox_items").update({ status: "done" }).eq("id", Number(id)).eq("status", "open");
  if (error) return { message: "操作失败，请刷新后重试" };
  revalidatePath("/admin", "page");
  return { message: "已标记处理。" };
}

/** 原始会话始终私有；站主明确整理的公开问答通过同事务发布/撤回。 */
export async function reviewConversation(_previous: { message: string }, form: FormData) {
  if (!(await getAdminIdentity()).owner) return { message: "需要站主身份" };
  const id = String(form.get("id") ?? "");
  const value = String(form.get("value") ?? "");
  if (!/^\d+$/.test(id) || !["public", "hidden"].includes(value)) return { message: "参数无效" };
  const question = String(form.get("question") ?? "").trim();
  const answer = String(form.get("answer") ?? "").trim();
  const confirmed = form.get("confirmed") === "on";
  if (value === "public" && (!question || question.length > 2000 || !answer || answer.length > 12000 || !confirmed)) return { message: "请填写公开问题与答复，并确认已移除个人信息和受限正文。" };
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("review_conversation", { p_id: Number(id), p_status: value, p_question: question, p_answer: answer, p_confirmed: confirmed });
  if (error) return { message: "操作失败，请刷新后重试" };
  revalidatePath("/admin", "page");
  return { message: value === "public" ? "公开问答已发布，原始对话保持私有。" : "公开问答已撤回，原始对话保持私有。" };
}
