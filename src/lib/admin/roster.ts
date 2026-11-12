import "server-only";
import { readAllAdminRows } from "./read-all";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RosterRow } from "@/lib/admin/roster-csv";

export type { RosterRow } from "@/lib/admin/roster-csv";
export { buildRosterCsv, ROSTER_STATUS_LABEL } from "@/lib/admin/roster-csv";

/** 活动报名名单：owner RLS 会话读取，调用方必须先过 getAdminIdentity owner 校验。 */
export async function listEventRoster(eventId: number): Promise<RosterRow[]> {
  const client = await createSupabaseServerClient();
  const rows = await readAllAdminRows<RosterRow & {id:number}>(client,"registrations","id,email,status,created_at",query=>query.eq("series_id",eventId));
  return rows.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id-b.id);
}
