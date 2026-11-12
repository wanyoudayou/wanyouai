import { NextResponse } from "next/server";
import { getUserIdentity } from "@/lib/account/session";
import { sameSiteOrigin } from "@/lib/publishing/auth";
import { readBoundedJson } from "@/lib/publishing/request-body";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUS: Record<string, number> = { LOGIN_REQUIRED: 401, INVALID: 400, NOT_FOUND: 404, NOT_SETTLED: 409, DUPLICATE: 409 };

/** 交易锚定评价（PRD §4.4）：仅已结案订单的交易对手可评；一单一评；append-only。权威在 submit_evaluation。 */
export async function POST(request: Request) {
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL)) return NextResponse.json({ message: "请求来源无效" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await readBoundedJson(request, 12 * 1024); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const bookingId = Number(body.bookingId);
  const rating = Number(body.rating);
  const content = typeof body.content === "string" ? body.content.trim().slice(0, 2000) : "";
  if (!Number.isInteger(bookingId) || bookingId <= 0) return NextResponse.json({ message: "参数无效" }, { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return NextResponse.json({ message: "请选择 1–5 星评分" }, { status: 400 });

  const { user } = await getUserIdentity();
  if (!user) return NextResponse.json({ message: "请登录后评价" }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("submit_evaluation", { p_booking: bookingId, p_rating: rating, p_content: content || null });
  if (error || !data) return NextResponse.json({ message: "提交失败，请稍后再试。" }, { status: 500 });
  const result = data as { ok: boolean; code?: string; message: string };
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: STATUS[result.code ?? ""] ?? 409 });
  return NextResponse.json({ ok: true, message: result.message });
}
