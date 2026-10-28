import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publicMediaUrl } from "@/lib/publishing/media-url";
import { assetMedia, type MediaAsset, MediaLibraryError } from "./types";
import type { Media } from "@/lib/publishing/types";
import {
  escapeLike,
  lastPage,
  parseListQuery,
  type RawListQuery,
} from "@/lib/admin/list-query";

export const ASSET_COLUMNS =
  "id,storage_path,sha256,mime_type,byte_size,width,height,name,alt,archived,created_at";
export function withAssetUrl(row: Omit<MediaAsset, "url">): MediaAsset {
  return { ...row, url: publicMediaUrl(row.storage_path) };
}
export async function registerMedia(media: Media, size: number, name: string) {
  const db = createSupabaseServiceClient({ timeoutMs: 15000 });
  const row = {
    storage_path: media.storage_path,
    sha256: media.sha256,
    mime_type: media.mime_type,
    width: media.width,
    height: media.height,
    byte_size: size,
    name: name.slice(0, 200) || "图片",
  };
  const insert = await db
    .from("media_assets")
    .upsert(row, { onConflict: "storage_path", ignoreDuplicates: true });
  if (insert.error) throw new Error("Media catalog unavailable");
  const result = await db
    .from("media_assets")
    .select(ASSET_COLUMNS)
    .eq("storage_path", media.storage_path)
    .single();
  if (
    result.error ||
    !result.data ||
    result.data.sha256 !== media.sha256 ||
    result.data.mime_type !== media.mime_type ||
    result.data.width !== media.width ||
    result.data.height !== media.height ||
    result.data.byte_size !== size
  )
    throw new Error("Media catalog conflict");
  return withAssetUrl(result.data);
}
export async function registeredMedia(paths: string[]) {
  if (!paths.length) return [];
  const result = await createSupabaseServiceClient({ timeoutMs: 15000 })
    .from("media_assets")
    .select(ASSET_COLUMNS)
    .in("storage_path", paths);
  if (result.error) throw new Error("Media catalog unavailable");
  return (result.data ?? []).map((row) => assetMedia(withAssetUrl(row)));
}
export async function getMediaAsset(id: string) {
  const db = await createSupabaseServerClient();
  const result = await db
    .from("media_assets")
    .select(ASSET_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (result.error) throw new Error("Media unavailable");
  if (!result.data) throw new MediaLibraryError("素材不存在或无权访问。");
  return withAssetUrl(result.data);
}
export async function listMediaAssets(raw: RawListQuery) {
  const query = parseListQuery(raw);
  query.status = query.status === "archived" ? "archived" : "ready";
  query.type = ["png", "jpeg", "webp", "gif"].includes(query.type)
    ? query.type
    : "";
  const db = await createSupabaseServerClient();
  const filtered = () => {
    let builder = db
      .from("media_assets")
      .select(ASSET_COLUMNS, { count: "exact" })
      .eq("archived", query.status === "archived");
    if (query.q) builder = builder.ilike("name", `%${escapeLike(query.q)}%`);
    if (query.type) builder = builder.eq("mime_type", `image/${query.type}`);
    return builder;
  };
  const count = await filtered().limit(0);
  if (count.error || count.count === null)
    throw new Error("Media count unavailable");
  query.page = Math.min(query.page, lastPage(count.count, query.pageSize));
  const column = query.sort === "title" ? "name" : "created_at";
  const result = await filtered()
    .order(column, { ascending: query.sort !== "newest" })
    .order("id", { ascending: query.sort !== "newest" })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (result.error) throw new Error("Media list unavailable");
  return {
    items: (result.data ?? []).map(withAssetUrl),
    total: count.count,
    query,
  };
}
