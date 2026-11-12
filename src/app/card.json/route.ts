import { getCardData } from "@/lib/get-card";
import { machineResponse } from "@/lib/machine-output";
export async function GET(request: Request) {
  try { return machineResponse(JSON.stringify((await getCardData({ includeEvaluations: false })).machine), "application/json; charset=utf-8", request); }
  catch { return Response.json({ error: "名片数据暂时不可用" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
