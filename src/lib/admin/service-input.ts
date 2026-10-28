export const PROTOCOL_FIELDS = { scope: "服务范围", deliverable: "交付成果", cadence: "节奏与期限", compensation: "费用与结算约定", exit: "退出机制", ownership: "所有权与责任" };
export const STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", paused: "已暂停", archived: "已归档" };
export function allowedServiceStates(current: string) { return ({ draft: ["draft", "published"], published: ["published", "paused"], paused: ["paused", "published", "archived"], archived: [] } as Record<string, string[]>)[current] ?? []; }
export function parseService(form: FormData, current: string) {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const protocol_snapshot = Object.fromEntries(Object.keys(PROTOCOL_FIELDS).map((key) => [key, text(key)]));
  const status = text("status"), price = text("price"), capacity = text("capacity_per_month"), sort = text("sort");
  if (!allowedServiceStates(current).includes(status)) throw new Error("不允许此状态变更，请刷新确认。");
  if (status === "archived" && form.get("archive_notice") !== "on") throw new Error("请确认归档，归档后不可恢复。");
  if (!/^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/.test(text("slug")) || !text("title") || text("title").length > 200) throw new Error("请检查标题与网址标识。");
  if ((price && !/^\d{1,8}(\.\d{1,2})?$/.test(price)) || (capacity && !/^\d{1,6}$/.test(capacity)) || !/^-?\d{1,6}$/.test(sort)) throw new Error("价格、容量或排序格式无效。");
  if (Object.values(protocol_snapshot).some((value) => value.length > 3000) || text("summary").length > 1000 || text("duration").length > 200 || text("deliverables").length > 3000) throw new Error("文字过长，请缩短后重试。");
  const deliverables = text("deliverables").split("\n").map((value) => value.trim()).filter(Boolean);
  if (status === "published" && (!price || !text("duration") || !deliverables.length || Object.values(protocol_snapshot).some((value) => !value))) throw new Error("上架前请填写价格、交付周期、交付清单和完整六要素。");
  return { slug: text("slug"), title: text("title"), summary: text("summary") || null, deliverables, duration: text("duration") || null, price: price ? Number(price) : null, capacity_per_month: capacity ? Number(capacity) : null, sort: Number(sort), protocol_snapshot, status };
}
