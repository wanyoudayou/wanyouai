import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** 交易锚定评价（PRD §4.4）：仅已结案订单的交易对手可评；一单一评（unique）；append-only。 */
export async function POST(request: Request) {
  let body: { bookingId?: unknown; rating?: unknown; content?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const bookingId = Number(body.bookingId);
  const rating = Number(body.rating);
  const content = typeof body.content === "string" ? body.content.trim().slice(0, 2000) : "";
  if (!Number.isInteger(bookingId) || bookingId <= 0) return NextResponse.json({ message: "参数无效" }, { status: 400 });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return NextResponse.json({ message: "请选择 1–5 星评分" }, { status: 400 });

  const reader = await getReader();
  if (!reader.userId) return NextResponse.json({ message: "请登录后评价" }, { status: 401 });
  const service = createSupabaseServiceClient();
  const { data: booking } = await service.from("bookings").select("id,user_id,status").eq("id", bookingId).maybeSingle();
  if (!booking || booking.user_id !== reader.userId) return NextResponse.json({ message: "订单不存在" }, { status: 404 });
  if (booking.status !== "settled") return NextResponse.json({ message: "订单结案后才能评价" }, { status: 409 });

  const { error } = await service.from("evaluations").insert({ booking_id: bookingId, rating, content: content || null });
  if (error) {
    if (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "")) {
      return NextResponse.json({ message: "本订单已评价过，感谢你的反馈。" }, { status: 409 });
    }
    return NextResponse.json({ message: "提交失败，请稍后再试。" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: "感谢评价，已展示在服务页。" });
}
