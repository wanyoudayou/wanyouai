import { getAdminIdentity } from "@/lib/admin/session";
import { buildSiteExportZip } from "@/lib/admin/export";
import { createSiteExportResponse } from "@/lib/admin/export-response";

export const maxDuration = 60;

/** 一键导出：完整性核对后打包 ZIP，仅 owner 会话可下载。 */
export async function GET() {
  return createSiteExportResponse({
    getIdentity: getAdminIdentity,
    buildArchive: buildSiteExportZip,
  });
}
