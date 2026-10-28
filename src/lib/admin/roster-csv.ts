/** 活动报名名单 CSV 纯函数层。无服务端依赖、不 import "server-only"，供 tsx 单测直接导入。 */

export type RosterRow = {
  email: string;
  status: string;
  created_at: string;
};

export const ROSTER_STATUS_LABEL: Record<string, string> = {
  registered: "已报名",
  attended: "已到场",
  cancelled: "已取消",
};

/** 报名名单 CSV：邮箱 / 状态（中文）/ 报名时间（ISO）。 */
export function buildRosterCsv(rows: RosterRow[]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["email,status,registered_at"];
  for (const row of rows) {
    lines.push(`${escape(row.email)},${ROSTER_STATUS_LABEL[row.status] ?? row.status},${row.created_at}`);
  }
  return lines.join("\n") + "\n";
}
