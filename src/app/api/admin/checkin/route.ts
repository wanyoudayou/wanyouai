import { NextResponse } from "next/server";
import { getAdminIdentity } from "@/lib/admin/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 扫码核销（站主手机端 /admin/checkin 扫码后调用）：token 校验 + checkin_registration RPC（幂等）。 */
export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return NextResponse.json({ message: "请求来源无效" }, { status: 403 });
  if (!(await getAdminIdentity()).owner) return NextResponse.json({ message: "需要站主身份" }, { status: 401 });
  let body: { token?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const token = String(body.token ?? "");
  if (!uuidRe.test(token)) return NextResponse.json({ message: "不是有效的核销码" }, { status: 400 });
  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("checkin_registration", { p_token: token });
  if (error) return NextResponse.json({ message: "核销暂时不可用，请重试" }, { status: 500 });
  return NextResponse.json(data);
}
