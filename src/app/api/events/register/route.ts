import { NextResponse } from "next/server";
import { getReader } from "@/lib/reading/viewer";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { checkEligibility } from "@/lib/events/eligibility";

/** 活动报名：资格判定 → registrations 落库（unique(series_id,email) 幂等）。 */
export async function POST(request: Request) {
  let body: { series_id?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ message: "请求格式无效" }, { status: 400 }); }
  const seriesId = Number(body.series_id);
  if (!Number.isInteger(seriesId) || seriesId <= 0) return NextResponse.json({ message: "参数无效" }, { status: 400 });

  const reader = await getReader();
  if (!reader.userId) return NextResponse.json({ message: "报名需登录（注册即可）。" }, { status: 401 });
  const service = createSupabaseServiceClient();

  const { data: series } = await service.from("series").select("id,title,status,type").eq("id", seriesId).maybeSingle();
  if (!series || series.type !== "event") return NextResponse.json({ message: "活动不存在" }, { status: 404 });
  const { data: details } = await service.from("event_details").select("kind,ticket_price,state,capacity").eq("series_id", seriesId).maybeSingle();
  if (!details) return NextResponse.json({ message: "活动详情未配置" }, { status: 404 });

  const eligibility = checkEligibility(reader, { id: seriesId, status: series.status, kind: details.kind, ticket_price: details.ticket_price === null ? null : Number(details.ticket_price), state: details.state });
  if (eligibility.action === "closed") return NextResponse.json({ message: `暂不可报名：${eligibility.reason}` }, { status: 409 });
  if (eligibility.action === "subscription_required") return NextResponse.json({ message: "本活动为会员专享，订阅后即可免费报名。", status: "subscription_required" }, { status: 403 });
  if (eligibility.action === "buy_ticket") return NextResponse.json({ message: "本活动需购票后报名。", status: "ticket_required", price: eligibility.price }, { status: 403 });

  const email = (await service.auth.admin.getUserById(reader.userId)).data.user?.email;
  if (!email) return NextResponse.json({ message: "暂时无法获取账户邮箱，请稍后再试。" }, { status: 500 });

  // 满员校验（capacity 为数字时）
  const capacity = Number.parseInt(String(details.capacity ?? ""), 10);
  if (Number.isFinite(capacity) && capacity > 0) {
    const { data: existingRegs } = await service.from("registrations").select("id").eq("series_id", seriesId).eq("status", "registered").limit(capacity + 1);
    if ((existingRegs ?? []).length >= capacity) return NextResponse.json({ message: "名额已满，感谢关注。" }, { status: 409 });
  }

  // 幂等：同活动同邮箱重复报名返回原记录
  const { data: existing } = await service.from("registrations").select("id,status,checkin_token").eq("series_id", seriesId).eq("email", email).maybeSingle();
  if (existing) {
    if (existing.status === "cancelled") {
      await service.from("registrations").update({ status: "registered" }).eq("id", existing.id);
      return NextResponse.json({ ok: true, status: "registered", checkin_token: existing.checkin_token, message: "已恢复报名。" });
    }
    return NextResponse.json({ ok: true, status: existing.status, checkin_token: existing.checkin_token, message: "你已报名本活动。" });
  }
  const { data: inserted, error } = await service.from("registrations").insert({ series_id: seriesId, user_id: reader.userId, email }).select("id,status,checkin_token").single();
  if (error) return NextResponse.json({ message: "报名失败，请稍后再试。" }, { status: 500 });
  return NextResponse.json({ ok: true, status: inserted.status, checkin_token: inserted.checkin_token, message: "报名成功。" });
}
