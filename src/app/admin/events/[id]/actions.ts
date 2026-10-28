"use server";
import { revalidatePath } from "next/cache";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 手动标记到场：复用 checkin_registration，保持 token 核销与名单核销同一幂等语义。 */
export async function markAttended(form: FormData) {
  if (!(await getAdminIdentity()).owner) return;
  const token = String(form.get("token") ?? "");
  const eventId = String(form.get("event_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token) || !/^\d+$/.test(eventId)) return;
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("checkin_registration", { p_token: token });
  if (error) console.error("[checkin] manual mark failed", error.message);
  revalidatePath(`/admin/events/${eventId}`, "page");
}
