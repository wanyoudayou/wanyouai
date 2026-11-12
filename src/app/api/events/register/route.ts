import { NextResponse } from "next/server";
import { getUserIdentity } from "@/lib/account/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedJson } from "@/lib/publishing/request-body";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Registration = { ok: boolean; code?: string; status?: string; checkin_token?: string; price?: number; message: string };

const STATUS: Record<string, number> = { LOGIN_REQUIRED: 401, NOT_FOUND: 404, CLOSED: 409, FULL: 409, TICKET_REQUIRED: 403, SUBSCRIPTION_REQUIRED: 403, EMAIL_REQUIRED: 500 };

/** 活动报名：资格、名额与落库由 register_for_event 在活动行锁内一次裁决（持票人暂停/满员仍可报名）。 */
export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return NextResponse.json({ message: "请求来源无效" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await readBoundedJson(request, 1024); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const seriesId = Number(body.series_id);
  if (!Number.isInteger(seriesId) || seriesId <= 0) return NextResponse.json({ message: "参数无效" }, { status: 400 });

  const { user } = await getUserIdentity();
  if (!user) return NextResponse.json({ message: "报名需登录（注册即可）。" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("register_for_event", { p_series: seriesId });
  if (error || !data) return NextResponse.json({ message: "报名暂时不可用，请稍后再试。" }, { status: 503 });
  const result = data as Registration;
  if (!result.ok) {
    return NextResponse.json({ message: result.message, ...(result.status ? { status: result.status } : {}), ...(result.price !== undefined ? { price: Number(result.price) } : {}) }, { status: STATUS[result.code ?? ""] ?? 409 });
  }
  return NextResponse.json({ ok: true, status: result.status, checkin_token: result.checkin_token, message: result.message });
}
