"use server";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 确认核销（server action）：owner 会话调 checkin_registration RPC；失败回到核销页并提示。 */
export async function confirmCheckin(form: FormData) {
  const token = String(form.get("token") ?? "");
  if (!uuidRe.test(token)) redirect("/admin/checkin");
  if (!(await getAdminIdentity()).owner) redirect(`/login?next=${encodeURIComponent(`/checkin/${token}`)}`);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("checkin_registration", { p_token: token });
  // 失败要让站主看到，而不是静默回到原页面。
  if (error || !(data as { ok?: boolean } | null)?.ok) redirect(`/checkin/${token}?error=1`);
  redirect(`/checkin/${token}`);
}
