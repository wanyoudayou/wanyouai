import { publicMetadata } from "@/lib/seo/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getServiceBySlug } from "@/lib/get-services";
import { getSiteConfig } from "@/lib/get-site-config";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ServiceDetail } from "@/components/service/service-detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadTurnstilePublic } from "@/lib/turnstile-config";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const service = await getServiceBySlug(slug);
  return service
    ? publicMetadata(
        service.title,
        `/services/${encodeURIComponent(slug)}`,
        service.summary,
      )
    : { title: "服务不存在", robots: { index: false, follow: false } };
}

/** /services/[slug] 服务详情（页面契约 3.7）。 */
export default async function ServicePage({ params }: Props) {
  const { slug } = await params;
  const [service, site, identity, turnstile] = await Promise.all([
    getServiceBySlug(slug),
    getSiteConfig(),
    getUserIdentity(),
    createSupabaseServerClient().then(client => loadTurnstilePublic(client)).catch(() => null),
  ]);
  if (!service) notFound();
  const currency = site.commerce.subscriptionPrice?.currency ?? "CNY";
  // 交易锚定评价：该服务已结案订单的评价（公开，evaluations_public_read；不含个人信息）
  // bookings 表对 anon 无授权：评价取数走 service（仅用订单 id 关联，不输出任何订单字段）
  const client = createSupabaseServiceClient();
  const { data: settledBookings } = await client
    .from("bookings")
    .select("id")
    .eq("service_id", service.id)
    .eq("status", "settled")
    .limit(100);
  const bookingIds = (settledBookings ?? []).map((b) => b.id);
  const { data: evaluations } = bookingIds.length
    ? await client
        .from("evaluations")
        .select("id,rating,content,created_at")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12 lg:px-8">
      <ServiceDetail
        service={service}
        constraints={site.constraints}
        contact={site.contact}
        currency={currency}
        loggedIn={!!identity.user}
        turnstileSiteKey={turnstile?.enabled ? turnstile.siteKey : null}
        evaluations={evaluations ?? []}
      />
    </div>
  );
}
