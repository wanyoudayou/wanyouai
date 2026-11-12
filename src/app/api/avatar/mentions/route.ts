import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** @引用候选：已发布内容（博客 + 专辑）标题检索，任何人可读（公开目录数据，RLS 同源）。 */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length > 60) return NextResponse.json({ items: [] });
  const supabase = await createSupabaseServerClient();
  const [blogs, series] = await Promise.all([
    supabase
      .from("articles")
      .select("slug,title")
      .eq("type", "blog")
      .eq("status", "published")
      .ilike("title", `%${q}%`)
      .limit(6),
    supabase
      .from("series")
      .select("slug,title,type")
      .eq("status", "published")
      .ilike("title", `%${q}%`)
      .limit(6),
  ]);
  const items = [
    ...(blogs.data ?? []).map((b) => ({
      slug: b.slug,
      title: b.title,
      kind: "博客",
    })),
    ...(series.data ?? []).map((s) => ({
      slug: s.slug,
      title: s.title,
      kind:
        s.type === "collection"
          ? "普通专辑"
          : s.type === "skill"
            ? "技能"
            : s.type === "event"
              ? "活动"
              : "手册",
    })),
  ].slice(0, 8);
  return NextResponse.json({ items });
}
