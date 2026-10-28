"use server";
import { redirect } from "next/navigation";
import { getAdminIdentity } from "@/lib/admin/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 确认核销（server action）：owner 会话调 checkin_registration RPC。 */
export async function confirmCheckin(form: FormData) {
  const token = String(form.get("token") ?? "");
  if (!(await getAdminIdentity()).owner) redirect("/login");
  const client = await createSupabaseServerClient();
  const { error } = await client.rpc("checkin_registration", { p_token: token });
  if (error) console.error("[checkin]", error.message);
  redirect(`/checkin/${token}`);
}
