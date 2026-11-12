import "server-only";
import { readRelatedPages } from "./related-pages";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 履约订单数据：活跃 bookings + 服务名 + 里程碑。仅 owner 调用（页面已守卫）。 */
export async function getBookingsData(bookingId: number) {
  const client = await createSupabaseServerClient();
  const { data: siteRow } = await client
    .from("site_config")
    .select("owner_name, contact")
    .eq("id", 1)
    .maybeSingle();
  const ownerContact =
    (siteRow?.contact as { email?: string } | null)?.email ?? "";
  const ownerParty = [siteRow?.owner_name, ownerContact]
    .filter(Boolean)
    .join(" · ");
  const { data: bookings, error } = await client
    .from("bookings")
    .select(
      "id,service_id,email,intent,budget_range,deadline,status,agreed_at,agreement_snapshot,agreement_sent_at,agreement_confirmed_at,quote_snapshot,delivery_snapshot,revision_notes,created_at,updated_at",
    )
    .eq("id", bookingId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("订单数据暂时不可用");
  const all = bookings ?? [];
  const list = all.filter(
    (b) => b.status !== "settled" && b.status !== "declined",
  );
  const closed = all.filter(
    (b) => b.status === "settled" || b.status === "declined",
  );
  const serviceIds = [...new Set(all.map((b) => b.service_id))];
  const bookingIds = all.map((b) => b.id);
  const [services, milestones] = await Promise.all([
    serviceIds.length
      ? client
          .from("services")
          .select("id,title,protocol_snapshot,deliverables,price")
          .in("id", serviceIds)
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? readRelatedPages((from, to) =>
          client
            .from("milestones")
            .select(
              "id,booking_id,title,owner_party,expected_at,actual_at,status,sort,client_request,client_requested_at,client_response,client_responded_at,completion_note,accepted_at,objection_note,objected_at,events",
            )
            .in("booking_id", bookingIds)
            .order("sort")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (services.error || milestones.error) throw new Error("订单明细暂时不可用");
  type ServiceInfo = {
    title: string;
    protocol: Record<string, string> | null;
    deliverables: string[];
    price: number | null;
  };
  const serviceById = new Map<number, ServiceInfo>(
    (services.data ?? []).map((s) => [
      s.id,
      {
        title: s.title,
        protocol: (s.protocol_snapshot ?? null) as Record<
          string,
          string
        > | null,
        deliverables: (s.deliverables ?? []) as string[],
        price: (s.price ?? null) as number | null,
      },
    ]),
  );
  const attach = (b: (typeof all)[number]) => {
    const service = serviceById.get(b.service_id);
    return {
      ...b,
      serviceTitle: service?.title ?? "服务",
      serviceProtocol: service?.protocol ?? null,
      serviceDeliverables: service?.deliverables ?? [],
      servicePrice: service?.price ?? null,
      milestones: (milestones.data ?? []).filter((m) => m.booking_id === b.id),
      ownerParty,
    };
  };
  return { active: list.map(attach), closed: closed.map(attach) };
}
