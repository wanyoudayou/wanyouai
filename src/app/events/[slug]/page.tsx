import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSeries, getSeriesSeo } from "@/lib/get-series";
import { getSiteConfig } from "@/lib/get-site-config";
import { getReader } from "@/lib/reading/viewer";
import { hasEntitlement } from "@/lib/reading/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkEligibility, type Eligibility } from "@/lib/events/eligibility";
import type { RegisteredInfo } from "@/components/reading/event-register-panel";
import { checkinQrSvg } from "@/lib/events/qr";
import { getSiteUrl } from "@/lib/site-url";
import { SeriesDetail } from "@/components/reading/series-detail";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ article?: string | string[] }>;
}
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  return getSeriesSeo(
    "event",
    (await params).slug,
    (await searchParams).article,
  );
}
export default async function DetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { article } = await searchParams;
  if (Array.isArray(article)) notFound();
  const [data, site, reader] = await Promise.all([
    getSeries("event", slug, article),
    getSiteConfig(),
    getReader(),
  ]);
  const viewer = {
    loggedIn: reader.userId !== null,
    subscribed: hasEntitlement(reader, "subscription", null),
  };
  if (!data) notFound();
  // 报名面板数据：资格判定 + 本人报名记录
  let registration: {
    eligibility: Eligibility;
    row: RegisteredInfo | null;
  } | null = null;
  if (data.series.type === "event" && data.event) {
    const eligibility = checkEligibility(reader, {
      id: data.series.id,
      status: data.series.status,
      kind: data.event.kind,
      ticket_price:
        data.event.ticket_price === null
          ? null
          : Number(data.event.ticket_price),
      state: data.event.state,
    });
    let row: RegisteredInfo | null = null;
    if (reader.userId) {
      const client = await createSupabaseServerClient();
      const { data: reg } = await client
        .from("registrations")
        .select("status,checkin_token")
        .eq("series_id", data.series.id)
        .eq("user_id", reader.userId)
        .maybeSingle();
      row = (reg as RegisteredInfo | null) ?? null;
    }
    // 报名成功卡就地出核销二维码
    const qrSvg =
      row && row.status !== "cancelled" && getSiteUrl()
        ? await checkinQrSvg(`${getSiteUrl()}/checkin/${row.checkin_token}`)
        : null;
    registration = { eligibility, row: row ? { ...row, qrSvg } : null };
  }
  return (
    <SeriesDetail
      data={data}
      site={site}
      viewer={viewer}
      registration={registration}
    />
  );
}
