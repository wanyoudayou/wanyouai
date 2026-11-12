import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceCardRow } from "@/types/database";
import type { ServiceCardData } from "@/types/content";

export interface ServiceDetailData extends ServiceCardData {
  id: number;
  protocolSnapshot: Record<string, string> | null;
}

function toCard(row: ServiceCardRow): ServiceCardData {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    deliverables: row.deliverables ?? [],
    duration: row.duration,
    price: row.price === null ? null : Number(row.price),
    capacityPerMonth: row.capacity_per_month,
  };
}

/** /services 列表：仅 published 且价格完整（与 card.json 可售输出同一口径）。 */
export async function getServices(): Promise<ServiceCardData[]> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase
      .from("services")
      .select("slug, title, summary, deliverables, duration, price, capacity_per_month")
      .eq("status", "published")
      .not("price", "is", null)
      .order("sort", { ascending: true });
    if (error) {
      console.error("[getServices]", error.message);
      return [];
    }
    return ((data ?? []) as ServiceCardRow[]).map(toCard);
  } catch (error) {
    console.error("[getServices]", error);
    return [];
  }
}

/** 服务详情：published 才可见；draft/paused/archived 一律 404（ paused 停售不停读不适用服务）。 */
export async function getServiceBySlug(slug: string): Promise<ServiceDetailData | null> {
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase
      .from("services")
      .select("id, slug, title, summary, deliverables, duration, price, capacity_per_month, protocol_snapshot")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (error) {
      console.error("[getServiceBySlug]", error.message);
      return null;
    }
    if (!data) return null;
    const row = data as ServiceCardRow & { id: number; protocol_snapshot: Record<string, string> | null };
    return { ...toCard(row), id: row.id, protocolSnapshot: row.protocol_snapshot };
  } catch (error) {
    console.error("[getServiceBySlug]", error);
    return null;
  }
}
