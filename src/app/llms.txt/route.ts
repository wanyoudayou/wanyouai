import { getPublicCatalog } from "@/lib/public-catalog";
import { buildLlmsText, machineResponse } from "@/lib/machine-output";
import { getSiteUrl } from "@/lib/site-url";
export async function GET(request: Request) {
  try {
    const origin = getSiteUrl(); if (!origin) throw new Error("站点地址未配置");
    return machineResponse(buildLlmsText(await getPublicCatalog(), origin), "text/plain; charset=utf-8", request);
  } catch { return new Response("公开目录暂时不可用", { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
