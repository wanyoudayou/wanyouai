import "server-only";
import { readRelatedPages } from "./related-pages";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 收件箱数据：转人工/询价留言 + 待审核会话。仅 owner 调用（页面已守卫）。 */
export async function getInboxData(id: number, kind: "item" | "conversation") {
  const client = await createSupabaseServerClient();
  const [items, pending] = await Promise.all([
    kind === "item"
      ? client
          .from("inbox_items")
          .select("id,kind,contact,payload,status,created_at")
          .order("status", { ascending: true })
          .order("created_at", { ascending: false })
          .eq("id", id)
      : Promise.resolve({ data: [], error: null }),
    kind === "conversation"
      ? client
          .from("conversations")
          .select("id,article_id,created_at,status")
          .order("status")
          .order("created_at", { ascending: false })
          .eq("id", id)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (items.error || pending.error) throw new Error("收件箱数据暂时不可用");
  const conversations = pending.data ?? [];
  const ids = conversations.map((c) => c.id);
  const articleIds = [
    ...new Set(
      conversations
        .map((c) => c.article_id)
        .filter((v): v is number => v !== null),
    ),
  ];
  const [messages, articles, publications] = await Promise.all([
    ids.length
      ? readRelatedPages((from, to) =>
          client
            .from("conversation_messages")
            .select("conversation_id,role,content")
            .in("conversation_id", ids)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve({ data: [], error: null }),
    articleIds.length
      ? client.from("articles").select("id,title,slug").in("id", articleIds)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? client
          .from("conversation_publications")
          .select("conversation_id,question_md,answer_md,updated_at")
          .in("conversation_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (messages.error || articles.error || publications.error)
    throw new Error("收件箱明细暂时不可用");
  const firstUserMessage = new Map<number, string>();
  for (const message of messages.data ?? []) {
    if (
      message.role === "user" &&
      !firstUserMessage.has(message.conversation_id)
    )
      firstUserMessage.set(message.conversation_id, message.content);
  }
  const articleTitle = new Map(
    (articles.data ?? []).map((a) => [a.id, a.title]),
  );
  const publicCopy = new Map(
    (publications.data ?? []).map((p) => [p.conversation_id, p]),
  );
  return {
    items: items.data ?? [],
    pending: conversations.map((c) => ({
      id: c.id,
      created_at: c.created_at,
      articleTitle:
        c.article_id !== null ? (articleTitle.get(c.article_id) ?? null) : null,
      preview: firstUserMessage.get(c.id) ?? "（无用户消息）",
      originalMessages: (messages.data ?? [])
        .filter((m) => m.conversation_id === c.id)
        .map((m) => ({ role: String(m.role), content: String(m.content) })),
      publication: publicCopy.get(c.id) ?? null,
    })),
  };
}
