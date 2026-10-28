import "server-only";

import { getListOwnership } from "@/lib/get-list-ownership";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ArticleAccess,
  EventDetailsRow,
  SeriesRow,
  SeriesType,
} from "@/types/database";
import type { AlbumCardData, AlbumManifestItem } from "@/types/content";

export type ColumnKind = SeriesType;
export type ColumnCardData = Required<
  Pick<
    AlbumCardData,
    "chapterCount" | "event" | "manifest" | "updatedAt" | "accesses"
  >
> &
  AlbumCardData;

import { SERIES_BASE as HREF_BASE } from "@/lib/content-kinds";

function parseManifest(value: unknown): AlbumManifestItem[] | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("files" in value) ||
    !Array.isArray(value.files)
  )
    return null;
  return value.files.flatMap((file: unknown) => {
    if (
      !file ||
      typeof file !== "object" ||
      !("path" in file) ||
      typeof file.path !== "string"
    )
      return [];
    const size =
      "size" in file &&
      typeof file.size === "number" &&
      Number.isFinite(file.size) &&
      file.size > 0
        ? file.size
        : 0;
    return [{ path: file.path, size }];
  });
}

/** 类型栏目只读取公开元数据，扩展表按栏目批量读取。 */
export async function getColumnItems(
  kind: ColumnKind,
  currency: string,
): Promise<ColumnCardData[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("series")
    .select(
      "id, slug, type, title, task, price, tags, audiences, featured, updated_at, readme_article_id",
    )
    .in("type", kind === "handbook" ? ["handbook", "collection"] : [kind])
    .eq("status", "published")
    .order("updated_at", { ascending: false });
  if (error) throw new Error("无法加载栏目");
  const rows = (data ?? []) as SeriesRow[];
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [chapters, details, isOwned] = await Promise.all([
    supabase
      .from("articles")
      .select("id, series_id, access, summary, cover_url")
      .in("series_id", ids)
      .eq("type", "chapter")
      .eq("status", "published"),
    kind === "event"
      ? supabase
          .from("event_details")
          .select("series_id, starts_at, state, ticket_price")
          .in("series_id", ids)
      : kind === "skill"
        ? supabase
            .from("skill_details")
            .select("series_id, file_manifest")
            .in("series_id", ids)
        : Promise.resolve({ data: [], error: null }),
    getListOwnership(supabase),
  ]);
  if (chapters.error || details.error) throw new Error("无法加载栏目详情");
  const chapterRows = (chapters.data ?? []) as {
    id: number;
    series_id: number;
    access: ArticleAccess;
    summary: string | null;
    cover_url: string | null;
  }[];
  const extensionRows = new Map(
    (details.data ?? []).map((row) => [row.series_id, row]),
  );

  const items = rows.map((row): ColumnCardData => {
    const members = chapterRows.filter(
      (chapter) => chapter.series_id === row.id,
    );
    const readme = members.find(
      (chapter) => chapter.id === row.readme_article_id,
    );
    const chapters = members.filter(
      (chapter) => chapter.id !== row.readme_article_id,
    );
    const extension = extensionRows.get(row.id);
    const detail =
      kind === "event" && extension
        ? (extension as Pick<
            EventDetailsRow,
            "starts_at" | "state" | "ticket_price"
          >)
        : null;
    return {
      href: `${HREF_BASE[kind]}/${row.slug}`,
      kind: row.type,
      title: row.title,
      summary: row.task ?? readme?.summary ?? null,
      coverUrl: readme?.cover_url ?? null,
      tags: row.tags ?? [],
      audiences: row.audiences ?? [],
      price: Number(row.price),
      currency,
      featured: row.featured === true,
      owned: isOwned(kind === "event" ? "event" : "series", row.id),
      updatedAt: row.updated_at,
      chapterCount: chapters.length,
      // README 始终公开；无普通章节时按公开介绍归类。
      accesses: [
        ...new Set(
          chapters.length
            ? chapters.map((chapter) => chapter.access)
            : ["public" as const],
        ),
      ],
      event: detail
        ? {
            startsAt: detail.starts_at,
            state: detail.state,
            ticketPrice:
              detail.ticket_price === null ? null : Number(detail.ticket_price),
          }
        : null,
      manifest:
        kind === "skill" && extension
          ? parseManifest(
              (extension as { file_manifest: unknown }).file_manifest,
            )
          : null,
    };
  });
  if (kind === "event")
    items.sort((a, b) =>
      (a.event?.startsAt ?? "").localeCompare(b.event?.startsAt ?? ""),
    );
  return items;
}
