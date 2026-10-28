import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MeTabs } from "@/components/account/me-tabs";
import { NicknameEditor } from "@/components/account/nickname-editor";
import { DAILY_LIMIT } from "@/lib/avatar/answer";
import { getOrderContents } from "@/lib/orders/describe";

export const metadata: Metadata = { title: "我的权益", robots: { index: false, follow: false } };

export default async function MePage() {
  const { user } = await getUserIdentity();
  if (!user) redirect("/login");
  const client = await createSupabaseServerClient();
  const [entitlements, orders, bookings, registrations] = await Promise.all([
    client.from("entitlements").select("id,type,target_id,starts_at,ends_at,source").eq("user_id", user.id).is("revoked_at", null).order("created_at", { ascending: false }),
    client.from("orders").select("id,sku_type,target_id,amount,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    client.from("bookings").select("id,service_id,status,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
    client.from("registrations").select("id,series_id,status,checkin_token,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (entitlements.error || orders.error || bookings.error || registrations.error) throw new Error("账户数据暂时不可用");
  const serviceIds = [...new Set((bookings.data ?? []).map((b) => b.service_id))];
  const [{ data: serviceRows }, orderContents] = await Promise.all([
    serviceIds.length ? client.from("services").select("id,title").in("id", serviceIds) : Promise.resolve({ data: [] }),
    getOrderContents(client, orders.data ?? []),
  ]);
  const myOrders = (orders.data ?? []).map((order, index) => ({ ...order, content: orderContents[index] }));
  const serviceTitle = new Map((serviceRows ?? []).map((s) => [s.id, s.title]));
  const myBookings = (bookings.data ?? []).map((b) => ({ ...b, serviceTitle: serviceTitle.get(b.service_id) ?? "服务" }));
  // 活动报名：关联活动标题与状态
  const regSeriesIds = [...new Set((registrations.data ?? []).map((r) => r.series_id))];
  const [regSeries, regEvents] = await Promise.all([
    regSeriesIds.length ? client.from("series").select("id,slug,title").in("id", regSeriesIds) : Promise.resolve({ data: [] }),
    regSeriesIds.length ? client.from("event_details").select("series_id,state,starts_at").in("series_id", regSeriesIds) : Promise.resolve({ data: [] }),
  ]);
  const seriesInfo = new Map((regSeries.data ?? []).map((s) => [s.id, s]));
  const eventInfo = new Map((regEvents.data ?? []).map((e) => [e.series_id, e]));
  const myRegistrations = (registrations.data ?? []).map((r) => ({
    ...r,
    slug: seriesInfo.get(r.series_id)?.slug ?? "",
    title: seriesInfo.get(r.series_id)?.title ?? "活动",
    state: eventInfo.get(r.series_id)?.state ?? "",
    startsAt: eventInfo.get(r.series_id)?.starts_at ?? null,
  }));
  const now = new Date().toISOString();
  const active = (entitlements.data ?? []).filter((e) => e.starts_at <= now && (!e.ends_at || e.ends_at > now));
  const subscription = active.find((e) => e.type === "subscription") ?? null;
  // 用本人专用聚合读取用量，不向客户端开放 AI 调用明细。
  const { data: profile } = await client.from("profiles").select("display_name,is_owner").eq("id", user.id).maybeSingle();
  const { data: usedToday, error: usageError } = await client.rpc("avatar_usage_today");
  const dailyCap = subscription ? DAILY_LIMIT.subscriber : DAILY_LIMIT.registered;
  return <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
    <Link href="/" className="text-sm underline">返回首页</Link>
    <h1 className="text-2xl font-medium">我的权益</h1>
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
      <NicknameEditor current={profile?.display_name ?? null} />
      <p className="text-xs text-muted-foreground">当前登录：{user.email} · 今日生成（UTC）：{profile?.is_owner ? "日配额不限，站级月限额仍适用" : usageError || usedToday === null ? "配额暂不可用" : `剩余 ${Math.max(0, dailyCap - usedToday)} / ${dailyCap}`}</p>
    </section>
    <MeTabs subscription={subscription ? { endsAt: subscription.ends_at } : null} entitlements={active} orders={myOrders} bookings={myBookings} registrations={myRegistrations} />
  </div>;
}
