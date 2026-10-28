import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  sanitizeCustomHtml,
  isValidPageSlug,
} from "@/lib/custom-pages/sanitize";
import type { CustomPageRow } from "@/lib/custom-pages/get-page";

export type { CustomPageRow } from "@/lib/custom-pages/get-page";

/** Metadata choices for configuration; full HTML is loaded only after a selection. */
export async function listCustomPages(): Promise<
  Omit<CustomPageRow, "html">[]
> {
  const client = await createSupabaseServerClient();
  const rows: Omit<CustomPageRow, "html">[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from("custom_pages")
      .select(
        "id,slug,title,description,status,nav_label,nav_order,placement,updated_at",
      )
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("页面选项暂时不可用");
    rows.push(...(data as Omit<CustomPageRow, "html">[]));
    if (data.length < 500) return rows;
  }
}

export interface CustomPageInput {
  id?: number;
  slug: string;
  title: string;
  description: string | null;
  html: string;
  status: "draft" | "published" | "archived";
  nav_label: string | null;
  nav_order: number;
  placement: "nav" | "footer" | "none";
}

/** 保存（新建/更新）自定义页：html 保存时净化；updated_at 乐观锁防并发覆盖。 */
export async function saveCustomPage(
  input: CustomPageInput,
  expectedUpdatedAt?: string,
): Promise<{ id: number }> {
  if (!isValidPageSlug(input.slug))
    throw new Error("网址标识需为小写字母/数字/短横线（1–61 位）。");
  if (!input.title.trim() || input.title.length > 120)
    throw new Error("请填写 120 字以内的页面标题。");
  const client = await createSupabaseServerClient();
  const row = {
    slug: input.slug,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    html: sanitizeCustomHtml(input.html),
    status: input.status,
    nav_label: input.nav_label?.trim() || null,
    nav_order: input.nav_order,
    placement: input.placement,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    let query = client.from("custom_pages").update(row).eq("id", input.id);
    if (expectedUpdatedAt) query = query.eq("updated_at", expectedUpdatedAt);
    const { data, error } = await query.select("id");
    if (error)
      throw new Error(
        error.code === "23505"
          ? "此网址标识已被占用。"
          : "保存失败，请稍后重试。",
      );
    if (!data?.length)
      throw new Error("保存失败或页面已被他人更新，请刷新后重试。");
    return { id: data[0].id as number };
  }
  const { data, error } = await client
    .from("custom_pages")
    .insert(row)
    .select("id");
  if (error)
    throw new Error(
      error.code === "23505"
        ? "此网址标识已被占用。"
        : "创建失败，请稍后重试。",
    );
  return { id: data[0].id as number };
}

/** 预览净化（编辑器预览与保存同一管线）。 */
export function previewCustomHtml(html: string): string {
  return sanitizeCustomHtml(html);
}
