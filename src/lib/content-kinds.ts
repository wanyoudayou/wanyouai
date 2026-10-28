import type { SeriesType } from "@/types/database";

export const SERIES_TYPES = [
  "collection",
  "handbook",
  "skill",
  "event",
] as const;
export const SERIES_BASE: Record<SeriesType, string> = {
  collection: "/handbooks",
  handbook: "/handbooks",
  skill: "/skills",
  event: "/events",
};
export const SERIES_LABEL: Record<SeriesType, string> = {
  collection: "手册",
  handbook: "手册",
  skill: "技能",
  event: "活动",
};
export const isSeriesType = (value: string): value is SeriesType =>
  SERIES_TYPES.some((type) => type === value);
export const isSeriesSellableType = (value: string) =>
  isSeriesType(value) && value !== "event";

/** Unknown types fail closed instead of silently generating another resource's URL. */
export function seriesPath(series: { type: string; slug: string }): string {
  if (!isSeriesType(series.type)) throw new Error("未知专辑类型");
  return `${SERIES_BASE[series.type]}/${encodeURIComponent(series.slug)}`;
}
