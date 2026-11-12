import { isSeriesSellableType } from "@/lib/content-kinds";
/** 交易服务端核心。价格 authority 全在本文件：客户端只能给 sku_type + target_id。 */
export type SkuType = "subscription" | "series" | "single" | "event" | "skill";

export interface OrderRow {
  id: number;
  merchant_order_no: string;
  user_id: string;
  sku_type: SkuType;
  target_id: number | null;
  amount: number;
  status: string;
  created_at: string;
}

/** 数据访问缝：生产走 Supabase service 网关，测试注入 PGlite 网关。 */
export interface OrderGateway {
  skillSku(target: number): Promise<{ id: number; status: string; price: number; current_release: string | null } | null>;
  subscriptionPrice(): Promise<{ amount: number } | null>;
  seriesSku(target: number): Promise<{
    id: number;
    type: string;
    status: string;
    price: number;
  } | null>;
  articleSku(target: number): Promise<{
    id: number;
    type: string;
    access: string;
    status: string;
    series_id: number | null;
    price: number;
  } | null>;
  /** 活动票：活动专辑 + event_details 票价与生命周期。 */
  eventSku(target: number): Promise<{
    id: number;
    status: string;
    ticket_price: number | null;
    state: string;
  } | null>;
  activeEntitlements(
    userId: string,
  ): Promise<
    { type: string; target_id: number | null; ends_at: string | null }[]
  >;
  /** Atomic authority: recheck current price/rights, then reuse or insert under a transaction lock. */
  createPendingOrder(
    userId: string,
    sku: SkuType,
    target: number | null,
    amount: number,
  ): Promise<OrderRow>;
}

export type OrderErrorCode =
  | "INVALID_SKU"
  | "NOT_SELLABLE"
  | "ALREADY_ENTITLED";
export class OrderError extends Error {
  constructor(
    public code: OrderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function parseSkuInput(raw: unknown): {
  sku_type: SkuType;
  target_id: number | null;
} {
  const input = (raw ?? {}) as Record<string, unknown>;
  if (input.amount !== undefined)
    throw new OrderError("INVALID_SKU", "金额由服务端计算，客户端不可指定。");
  const sku = String(input.sku_type ?? "");
  if (!["subscription", "series", "single", "event", "skill"].includes(sku))
    throw new OrderError("INVALID_SKU", "商品类型无效。");
  const rawTarget = input.target_id;
  const target =
    rawTarget === undefined || rawTarget === null ? null : Number(rawTarget);
  if (sku === "subscription") {
    if (rawTarget !== undefined && rawTarget !== null)
      throw new OrderError("INVALID_SKU", "订阅不需要目标。");
    return { sku_type: "subscription", target_id: null };
  }
  if (target === null || !Number.isInteger(target) || target <= 0)
    throw new OrderError("INVALID_SKU", "商品目标无效。");
  return { sku_type: sku as SkuType, target_id: target };
}

export async function createOrder(
  gateway: OrderGateway,
  userId: string,
  raw: unknown,
): Promise<OrderRow> {
  const input = parseSkuInput(raw);
  let amount: number;
  if (input.sku_type === "subscription") {
    const price = await gateway.subscriptionPrice();
    if (!price || price.amount <= 0)
      throw new OrderError("NOT_SELLABLE", "订阅暂未开通。");
    amount = price.amount;
  } else if (input.sku_type === "series") {
    const series = await gateway.seriesSku(input.target_id!);
    if (
      !series ||
      !isSeriesSellableType(series.type) ||
      series.status !== "published" ||
      Number(series.price) <= 0
    )
      throw new OrderError("NOT_SELLABLE", "该专辑当前不可购买。");
    amount = Number(series.price);
  } else if (input.sku_type === "skill") {
    const skill = await gateway.skillSku(input.target_id!);
    if (!skill || skill.status !== "published" || !skill.current_release || Number(skill.price) <= 0)
      throw new OrderError("NOT_SELLABLE", "该 Skill 当前不可购买。");
    amount = Number(skill.price);
  } else if (input.sku_type === "event") {
    const event = await gateway.eventSku(input.target_id!);
    // 活动票：上架 + 报名中（upcoming 可预售）+ 票价 > 0；免费活动不走订单（直接报名）。
    if (
      !event ||
      event.status !== "published" ||
      !["upcoming", "registering"].includes(event.state) ||
      event.ticket_price === null ||
      Number(event.ticket_price) <= 0
    )
      throw new OrderError("NOT_SELLABLE", "该活动当前不可购票。");
    amount = Number(event.ticket_price);
  } else {
    const article = await gateway.articleSku(input.target_id!);
    if (
      !article ||
      article.type !== "blog" ||
      article.access !== "paid" ||
      article.status !== "published" ||
      article.series_id !== null ||
      Number(article.price) <= 0
    )
      throw new OrderError(
        "NOT_SELLABLE",
        "该文章当前不可单买（仅独立付费博客支持单篇购买）。",
      );
    amount = Number(article.price);
  }
  const entitlements = await gateway.activeEntitlements(userId);
  const now = Date.now();
  const active = (type: string, target: number | null) =>
    entitlements.some(
      (e) =>
        e.type === type &&
        e.target_id === target &&
        (e.ends_at === null || Date.parse(e.ends_at) > now),
    );
  if (input.sku_type === "subscription" && active("subscription", null))
    throw new OrderError("ALREADY_ENTITLED", "已持有有效订阅。");
  if (
    input.sku_type === "series" &&
    (active("series", input.target_id) || active("subscription", null))
  )
    throw new OrderError("ALREADY_ENTITLED", "已持有本专辑或全站订阅。");
  // 与 PRD §6、正文 RLS 和 visible() 一致：全站订阅也覆盖付费单篇。
  if (
    input.sku_type === "single" &&
    (active("single", input.target_id) || active("subscription", null))
  )
    throw new OrderError("ALREADY_ENTITLED", "已持有本篇或全站订阅。");
  // 活动票：已有本活动票或全站订阅（会员专享语义）不可重复购。
  if (
    input.sku_type === "event" &&
    (active("event", input.target_id) || active("subscription", null))
  )
    throw new OrderError("ALREADY_ENTITLED", "已持有本活动票或全站订阅。");
  const inserted = await gateway.createPendingOrder(
    userId,
    input.sku_type,
    input.target_id,
    amount,
  );
  return { ...inserted, amount: Number(inserted.amount) };
}
