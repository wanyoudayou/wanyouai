import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getAdminIdentity } from "@/lib/admin/session";
import {
  parseListQuery,
  escapeLike,
  lastPage,
  type RawListQuery,
} from "./list-query";

const contentStates = ["draft", "published", "paused", "archived"];
export const RESOURCES = {
  articles: {
    title: "文章",
    description: "统一管理博客、专辑章节、Skill 公开介绍及待审核修订。",
    table: "admin_documents",
    select:
      "document_key,article_id,file_id,slug,title,pending_title,type,series_id,series_title,series_slug,series_type,status,access,online_version,pending_revision_id,pending_version,updated_at,is_readme,sort_order",
    search: "search_text",
    statuses: [...contentStates, "unpublished", "pending-review"],
    types: ["blog", "chapter", "skill"],
  },
  collections: {
    title: "专辑",
    description: "管理手册和活动的介绍与章节。旧技能章节保留兼容入口；新 Skill 在独立入口管理。",
    table: "admin_collections",
    select:
      "id,slug,title,type,status,chapter_count,nav_enabled,nav_label,nav_order,updated_at",
    search: "title",
    statuses: contentStates,
    types: ["collection", "handbook", "skill", "event"],
  },
  pages: {
    title: "独立页面",
    description: "管理收费方案、关于及政策页面；在详情中编辑内容与导航位置。",
    table: "custom_pages",
    select: "id,slug,title,status,placement,nav_label,nav_order,updated_at",
    search: "title",
    statuses: ["draft", "published", "archived"],
    types: [],
  },
  services: {
    title: "服务与履约",
    description: "服务项目负责对外展示；履约订单负责询价、交付与客户验收。",
    table: "services",
    select: "id,slug,title,status,price,updated_at",
    search: "title",
    statuses: contentStates,
    types: [],
  },
  payments: {
    title: "收款订单",
    description: "核对在线收款及关联权益；付款状态由支付平台与结算流程确认。",
    table: "orders",
    select:
      "id,merchant_order_no,user_id,sku_type,target_id,amount,status,created_at",
    search: "merchant_order_no",
    statuses: ["pending", "paid", "fulfilled", "failed", "refunded"],
    types: [],
  },
  users: {
    title: "用户与权益",
    description: "按邮箱或昵称查找账户，查看订阅、收款订单与权益来源。",
    table: "profiles",
    select: "id",
    search: "id",
    statuses: ["subscribed", "registered"],
    types: [],
  },
  inbox: {
    title: "收件箱",
    description: "处理转人工与询价留言；私有对话和公开稿分别管理。",
    table: "inbox_items",
    select: "id,kind,contact,status,created_at",
    search: "kind",
    statuses: ["open", "done"],
    types: [],
  },
  conversations: {
    title: "对话审核",
    description: "原始对话保持私有；公开内容须明确编辑后发布。",
    table: "conversations",
    select: "id,article_id,status,created_at",
    search: "status",
    statuses: ["pending", "public", "hidden"],
    types: [],
  },
  bookings: {
    title: "服务履约",
    description: "查看全部履约订单，进行中的订单不会被较新的已结束记录截断。",
    table: "bookings",
    select: "id,service_id,email,intent,status,created_at,updated_at",
    search: "intent",
    statuses: [
      "active",
      "closed",
      "inquiry",
      "quoted",
      "booked",
      "in_progress",
      "delivered",
      "accepted",
      "settled",
      "declined",
    ],
    types: [],
  },
  registrations: {
    title: "活动报名",
    description: "查看当前活动报名，使用既有核销入口处理到场。",
    table: "registrations",
    select: "id,series_id,email,status,checkin_token,created_at",
    search: "email",
    statuses: ["registered", "attended", "cancelled"],
    types: [],
  },
} as const;
export type ResourceKind = keyof typeof RESOURCES;
export type ListRecord = Record<string, unknown>;

/** Fixed domain projections only. No client-supplied table, column or SQL identifiers. */
export async function getAdminResourcePage(
  resource: ResourceKind,
  raw: RawListQuery,
) {
  if (!(await getAdminIdentity()).owner) throw new Error("需要站主身份");
  const spec = RESOURCES[resource];
  const query = parseListQuery(raw);
  if (!(spec.statuses as readonly string[]).includes(query.status))
    query.status = "";
  if (!(spec.types as readonly string[]).includes(query.type)) query.type = "";
  if (resource === "articles" && query.series && !raw.sort)
    query.sort = "reading";
  if (query.sort === "reading" && resource !== "articles")
    query.sort = "newest";
  if (query.sort === "active" && resource !== "users") query.sort = "newest";
  const client = await createSupabaseServerClient();
  let parentId: number | undefined;
  if (query.series && resource === "registrations") {
    const parent = await client
      .from("series")
      .select("id")
      .eq("slug", query.series)
      .maybeSingle();
    if (parent.error || !parent.data)
      throw new Error("所属专辑不存在或暂时不可读取");
    parentId = Number(parent.data.id);
  }
  const read = async (
    page: number,
  ): Promise<{ items: ListRecord[]; filteredTotal: number }> => {
    if (resource === "users") {
      const { data, error } = await createSupabaseServiceClient().rpc(
        "admin_user_directory",
        {
          p_q: query.q,
          p_status: query.status,
          p_sort: ["newest", "oldest", "active"].includes(query.sort)
            ? query.sort
            : "newest",
          p_offset: (page - 1) * query.pageSize,
          p_limit: query.pageSize,
        },
      );
      if (
        error ||
        !data ||
        !Array.isArray(data.items) ||
        !Number.isSafeInteger(data.filteredTotal)
      )
        throw new Error("用户列表暂时不可用");
      return data as { items: ListRecord[]; filteredTotal: number };
    }
    let request = client
      .from(spec.table)
      .select(spec.select, { count: "exact" });
    if (query.q)
      request = request.ilike(spec.search, `%${escapeLike(query.q)}%`);
    if (query.type) request = request.eq("type", query.type);
    if (resource === "articles") {
      if (query.status === "unpublished")
        request = request.is("article_id", null);
      else if (query.status === "pending-review")
        request = request.not("pending_revision_id", "is", null);
      else if (query.status) request = request.eq("status", query.status);
      if (query.series) request = request.eq("series_slug", query.series);
    } else if (resource === "bookings" && query.status === "active")
      request = request.not("status", "in", "(settled,declined)");
    else if (resource === "bookings" && query.status === "closed")
      request = request.in("status", ["settled", "declined"]);
    else if (query.status) request = request.eq("status", query.status);
    if (parentId !== undefined) request = request.eq("series_id", parentId);
    const date = [
      "payments",
      "inbox",
      "conversations",
      "registrations",
      "bookings",
    ].includes(resource)
      ? "created_at"
      : "updated_at";
    const key = resource === "articles" ? "document_key" : "id";
    if (query.sort === "reading")
      request = request.order("sort_order", { ascending: true });
    else if (
      query.sort === "title" &&
      ["articles", "collections", "pages", "services"].includes(resource)
    )
      request = request.order("title", { ascending: true });
    else
      request = request.order(date, {
        ascending: query.sort === "oldest",
        nullsFirst: false,
      });
    const { data, error, count } = await request
      .order(key, { ascending: false })
      .range((page - 1) * query.pageSize, page * query.pageSize - 1);
    if (error || count === null)
      throw new Error("列表暂时无法读取，请稍后重试");
    return {
      items: (data ?? []) as unknown as ListRecord[],
      filteredTotal: count,
    };
  };
  let result = await read(query.page);
  const normalized = Math.min(
    query.page,
    lastPage(result.filteredTotal, query.pageSize),
  );
  if (normalized !== query.page) {
    query.page = normalized;
    result = await read(normalized);
  }
  return { ...result, query, resource };
}
