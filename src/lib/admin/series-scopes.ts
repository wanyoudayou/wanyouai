import type { ResourceScope } from "@/components/admin/admin-resource-page";

/** 后台“专辑”资源按读者可见的类型拆成两个入口；旧普通专辑与旧技能章节归入手册以保持可管理。 */
export const HANDBOOK_SCOPE: ResourceScope = {
  types: ["handbook", "collection", "skill"],
  title: "手册",
  description: "管理手册的介绍、章节、价格与上架状态。",
  path: "/admin/collections",
  create: { label: "新建手册", href: "/admin/collections/new?type=handbook" },
};

export const EVENT_SCOPE: ResourceScope = {
  types: ["event"],
  title: "活动",
  description: "管理活动介绍、时间与票价、报名与到场核销。",
  path: "/admin/events",
  create: { label: "新建活动", href: "/admin/collections/new?type=event" },
};

export const seriesScope = (type: string) =>
  type === "event" ? EVENT_SCOPE : HANDBOOK_SCOPE;
