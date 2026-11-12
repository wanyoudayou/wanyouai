"use client";

import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import {
  BookOpenIcon,
  CalendarDaysIcon,
  FileTextIcon,
  WrenchIcon,
} from "lucide-react";

import { CardGrid } from "@/components/cards/card-grid";
import { ArticleCard } from "@/components/cards/article-card";
import { AlbumCard } from "@/components/cards/album-card";
import { EmptyState } from "@/components/shared/empty-state";
import {
  ListToolbar,
  type SortOrder,
  type ToolbarChip,
} from "@/components/list/list-toolbar";
import type { ArticleCardData, AlbumCardData } from "@/types/content";

/**
 * 列表浏览器（Tokens §6.2 ListToolbar + CardGrid 的客户端组合，契约 3.2 / 3.4）：
 * 搜索 / 排序 / 权限 chips 过滤均为纯客户端（OPC 站列表量级小，无分页）。
 * 数据全部来自服务端取数函数，组件内不发起请求。
 */

export type BrowserVariant =
  | "blog"
  | "collection"
  | "handbook"
  | "skill"
  | "event";

export interface ListEmptySpec {
  title: string;
  description?: string;
  action?: { href: string; label: string };
}

const EMPTY_ICONS = {
  blog: FileTextIcon,
  collection: BookOpenIcon,
  handbook: BookOpenIcon,
  skill: WrenchIcon,
  event: CalendarDaysIcon,
} as const;

function searchText(item: ArticleCardData | AlbumCardData): string {
  return [item.title, item.summary ?? "", ...(item.tags ?? [])]
    .join(" ")
    .toLowerCase();
}

export function ListBrowser({
  variant,
  items,
  timezone,
  chips,
  searchPlaceholder,
  empty,
}: {
  variant: BrowserVariant;
  items: (ArticleCardData | AlbumCardData)[];
  timezone: string;
  chips?: ToolbarChip[];
  searchPlaceholder: string;
  empty: ListEmptySpec;
}) {
  const params = useSearchParams();
  const search = (params.get("q") ?? "").slice(0, 120);
  const sort: SortOrder = ["oldest", "newest"].includes(
    params.get("sort") ?? "",
  )
    ? (params.get("sort") as SortOrder)
    : variant === "event"
      ? "oldest"
      : "newest";
  const selectedChip = params.get("access");
  const chip = chips?.some((item) => item.key === selectedChip)
    ? selectedChip!
    : "all";
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${next.size ? `?${next}` : ""}`,
    );
  };
  const setSearch = (value: string) => update("q", value);
  const setSort = (value: SortOrder) => update("sort", value);
  const setChip = (value: string) => update("access", value);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list = items.filter((item) => {
      if (query && !searchText(item).includes(query)) return false;
      if (chips && chip !== "all") {
        const accesses =
          "access" in item ? [item.access] : (item.accesses ?? []);
        if (chip === "free" && !accesses.includes("public")) return false;
        if (chip === "registered" && !accesses.includes("registered"))
          return false;
        if (
          chip === "subscriber" &&
          !accesses.some(
            (access) => access === "subscriber" || access === "paid",
          )
        )
          return false;
        if (chip === "single" && !("access" in item && item.access === "paid"))
          return false;
      }
      return true;
    });
    const keyOf = (item: ArticleCardData | AlbumCardData): string => {
      if ("access" in item) return item.publishedAt ?? "";
      if (item.event) return item.event.startsAt;
      return item.updatedAt ?? "";
    };
    list = [...list].sort((a, b) => {
      const diff = keyOf(a).localeCompare(keyOf(b));
      return sort === "newest" ? -diff : diff;
    });
    return list;
  }, [items, search, sort, chip, chips]);

  const EmptyIcon = EMPTY_ICONS[variant];

  return (
    <div className="flex flex-col gap-6">
      <ListToolbar
        search={search}
        onSearch={setSearch}
        sort={sort}
        onSort={setSort}
        chips={chips}
        chip={chip}
        onChip={setChip}
        searchPlaceholder={searchPlaceholder}
      />
      {items.length === 0 ? (
        <EmptyState
          Icon={EmptyIcon}
          title={empty.title}
          description={empty.description ?? null}
          action={empty.action ?? null}
        />
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          没有匹配的内容
        </p>
      ) : (
        <CardGrid>
          {filtered.map((item) =>
            "access" in item ? (
              <ArticleCard key={item.href} data={item} timezone={timezone} />
            ) : (
              <AlbumCard key={item.href} data={item} timezone={timezone} />
            ),
          )}
        </CardGrid>
      )}
    </div>
  );
}
