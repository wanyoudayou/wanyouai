import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { buildSiteExportArchive } from "@/lib/admin/export-archive";
import { readExportSnapshot } from "@/lib/admin/export-snapshot";

/** Owner HTTP authorization is mandatory. One RPC reads the application and Auth profiles in one MVCC snapshot. */
export async function buildSiteExportZip(now = new Date()): Promise<Uint8Array> {
  const service = createSupabaseServiceClient({ timeoutMs: 30000 });
  const snapshot = await readExportSnapshot(service);
  return buildSiteExportArchive(snapshot.rows, snapshot.users, now, {
    mode: "single_statement_snapshot", captured_at: snapshot.capturedAt,
  });
}
