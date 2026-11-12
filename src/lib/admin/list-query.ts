export type RawListQuery = Record<string, string | string[] | undefined>;
export type ListQuery = {
  q: string;
  status: string;
  type: string;
  sort: string;
  page: number;
  pageSize: number;
  series: string;
};
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";

export function parseListQuery(raw: RawListQuery): ListQuery {
  const integer = (value: string, fallback: number) =>
    /^[1-9]\d{0,6}$/.test(value) && Number(value) <= 1_000_000
      ? Number(value)
      : fallback;
  const size = Number(one(raw.pageSize));
  return {
    q: one(raw.q).trim().slice(0, 120),
    status: one(raw.status),
    type: one(raw.type),
    sort: ["newest", "oldest", "title", "reading", "active"].includes(
      one(raw.sort),
    )
      ? one(raw.sort)
      : "newest",
    page: integer(one(raw.page), 1),
    pageSize: [20, 50, 100].includes(size) ? size : 20,
    series: /^[a-z0-9][a-z0-9-]{0,119}$/.test(one(raw.series))
      ? one(raw.series)
      : "",
  };
}

export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
export const lastPage = (total: number, size: number) =>
  Math.max(1, Math.ceil(total / size));

export function listQueryString(
  query: ListQuery,
  changes: Partial<ListQuery> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...changes }))
    if (value !== "") params.set(key, String(value));
  return `?${params}`;
}

export function safeAdminReturn(
  value: string | null | undefined,
  fallback: string,
) {
  return typeof value === "string" &&
    /^\/admin(?:\/|\?|$)/.test(value) &&
    !/[\\\r\n]/.test(value)
    ? value
    : fallback;
}
