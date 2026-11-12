"use client";

import { SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * 列表工具条（Tokens §6.2 / 契约 3.2·3.4）：
 * Input 搜索 + Select 排序 + 可选权限计数 chips（Badge 可点选过滤，0 计数不渲染）。
 */

export interface ToolbarChip {
  key: string;
  label: string;
  count: number;
}

export type SortOrder = "newest" | "oldest";

export function ListToolbar({
  search,
  onSearch,
  sort,
  onSort,
  chips = [],
  chip = "all",
  onChip,
  searchPlaceholder = "搜索…",
}: {
  search: string;
  onSearch: (value: string) => void;
  sort: SortOrder;
  onSort: (value: SortOrder) => void;
  chips?: ToolbarChip[];
  chip?: string;
  onChip?: (key: string) => void;
  searchPlaceholder?: string;
}) {
  const visibleChips = chips.filter((c) => c.key === "all" || c.count > 0);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-40 flex-1 sm:max-w-xs">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9"
          aria-label="搜索"
        />
      </div>
      {visibleChips.length > 0 && onChip ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="按权限筛选">
          {visibleChips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChip(c.key)}
              aria-pressed={chip === c.key}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
                chip === c.key
                  ? "border-primary/40 bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
              <span className="text-[10px]">{c.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      <Select value={sort} onValueChange={(v) => onSort(v as SortOrder)}>
        <SelectTrigger className="ml-auto" aria-label="排序">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="newest">最新优先</SelectItem>
          <SelectItem value="oldest">最早优先</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
