import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportRows, ExportUser } from "./export-archive";
import { EXPORT_TABLES, exportCursorColumns } from "./export-pagination";

const AUTH_FIELDS = [
  "id",
  "email",
  "phone",
  "created_at",
  "updated_at",
  "last_sign_in_at",
  "email_confirmed_at",
  "app_metadata",
  "user_metadata",
];
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("导出快照结构不完整，请核对数据库升级");

/** Reject a truncated, mismatched or broadened RPC response before any ZIP is constructed. */
export function parseExportSnapshot(value: unknown): {
  rows: ExportRows;
  users: ExportUser[];
  capturedAt: string;
} {
  if (
    !object(value) ||
    value.format !== "wanyou.snapshot/1" ||
    typeof value.captured_at !== "string" ||
    !Number.isFinite(Date.parse(value.captured_at)) ||
    !object(value.rows) ||
    !Array.isArray(value.users)
  )
    throw invalid();
  if (
    Object.keys(value.rows).sort().join(",") !==
    [...EXPORT_TABLES].sort().join(",")
  )
    throw invalid();
  for (const table of EXPORT_TABLES) {
    const rows = value.rows[table];
    if (!Array.isArray(rows)) throw invalid();
    const seen = new Set<string>();
    for (const row of rows) {
      if (!object(row)) throw invalid();
      const keys = exportCursorColumns(table).map((key) => row[key]);
      if (
        keys.some(
          (key) =>
            !(typeof key === "string" && key.length > 0) &&
            !(typeof key === "number" && Number.isSafeInteger(key)),
        )
      )
        throw invalid();
      const id = JSON.stringify(keys);
      if (seen.has(id)) throw invalid();
      seen.add(id);
    }
  }
  const rows = value.rows as ExportRows;
  if (rows.site_config.length !== 1 || rows.app_schema_version.length !== 1)
    throw invalid();
  const seen = new Set<string>();
  for (const user of value.users) {
    if (
      !object(user) ||
      typeof user.id !== "string" ||
      !user.id ||
      seen.has(user.id) ||
      Object.keys(user).some((key) => !AUTH_FIELDS.includes(key)) ||
      (user.email !== null &&
        user.email !== undefined &&
        typeof user.email !== "string")
    )
      throw invalid();
    seen.add(user.id);
  }
  return {
    rows,
    users: value.users as ExportUser[],
    capturedAt: value.captured_at,
  };
}

export async function readExportSnapshot(client: SupabaseClient) {
  const result = await client.rpc("export_site_snapshot", {
    p_include_media: true,
    p_include_skills: true,
  });
  if (result.error) throw new Error("导出快照读取失败，请核对数据库升级及连接");
  return parseExportSnapshot(result.data);
}
