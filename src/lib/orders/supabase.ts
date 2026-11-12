import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { normalizeCommerceConfig } from "@/types/site";
import { OrderError, type OrderGateway, type OrderRow, type SkuType } from "./service";

/** 生产网关：service_role 服务端权威（RLS 不授予客户端 orders 写）。 */
export function supabaseOrderGateway(): OrderGateway {
  const client = createSupabaseServiceClient();
  return {
    async skillSku(target: number) {
      const [article, settings] = await Promise.all([
        client.from("articles").select("id,status").eq("id", target).eq("type", "skill").maybeSingle(),
        client.from("skills").select("price,current_release").eq("id", target).maybeSingle(),
      ]);
      if (article.error || settings.error) throw new Error("商品暂时不可用");
      return article.data && settings.data ? { ...article.data, price: Number(settings.data.price), current_release: settings.data.current_release } : null;
    },
    async subscriptionPrice() {
      const { data, error } = await client.from("site_config").select("commerce").eq("id", 1).maybeSingle();
      if (error) throw new Error("定价配置暂时不可用");
      const commerce = normalizeCommerceConfig(data?.commerce);
      return commerce.subscriptionPrice ? { amount: commerce.subscriptionPrice.amount } : null;
    },
    async seriesSku(target: number) {
      const { data, error } = await client.from("series").select("id,type,status,price").eq("id", target).maybeSingle();
      if (error) throw new Error("商品暂时不可用");
      return data as { id: number; type: string; status: string; price: number } | null;
    },
    async articleSku(target: number) {
      const { data, error } = await client.from("articles").select("id,type,access,status,series_id,price").eq("id", target).maybeSingle();
      if (error) throw new Error("商品暂时不可用");
      return data as { id: number; type: string; access: string; status: string; series_id: number | null; price: number } | null;
    },
    async eventSku(target: number) {
      const { data: series, error: seriesError } = await client.from("series").select("id,status,type").eq("id", target).maybeSingle();
      if (seriesError) throw new Error("商品暂时不可用");
      if (!series || series.type !== "event") return null;
      const { data: details, error } = await client.from("event_details").select("ticket_price,state").eq("series_id", target).maybeSingle();
      if (error) throw new Error("商品暂时不可用");
      if (!details) return null;
      return { id: series.id, status: series.status, ticket_price: details.ticket_price === null ? null : Number(details.ticket_price), state: details.state };
    },
    async activeEntitlements(userId: string) {
      const { data, error } = await client.from("entitlements").select("type,target_id,ends_at").eq("user_id", userId).is("revoked_at", null);
      if (error) throw new Error("权益数据暂时不可用");
      return (data ?? []) as { type: string; target_id: number | null; ends_at: string | null }[];
    },
    async createPendingOrder(userId: string, sku: SkuType, target: number | null, amount: number) {
      const { data, error } = await client.rpc("create_pending_order", { p_user_id: userId, p_sku: sku, p_target: target, p_amount: amount });
      if (error?.message.includes("ALREADY_ENTITLED")) throw new OrderError("ALREADY_ENTITLED", "已持有覆盖该商品的权益。");
      if (error?.message.includes("NOT_SELLABLE")) throw new OrderError("NOT_SELLABLE", "商品状态或价格已更新，请刷新后重试。");
      if (error) throw new Error("订单创建失败");
      return data as OrderRow;
    },
  };
}
