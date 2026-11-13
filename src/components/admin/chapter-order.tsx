"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { orderChapters } from "@/app/admin/manage-actions";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeTone } from "@/components/shared/status-badge";
import { ADMIN_LABELS } from "@/lib/admin/list-labels";

type Chapter = { id: number; title: string; status: string };
const TONE: Record<string, StatusBadgeTone> = { draft: "neutral", published: "success", paused: "paused", archived: "neutral" };

/** Reading order of every chapter in one album, saved in one step. */
export function ChapterOrder({ seriesId, chapters }: { seriesId: number; chapters: Chapter[] }) {
  const router = useRouter();
  const [items, setItems] = useState(chapters);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const changed = items.some((item, index) => item.id !== chapters[index]?.id);
  function move(index: number, offset: number) {
    const next = [...items];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setItems(next);
    setMessage("");
  }
  if (chapters.length < 2) return null;
  return (
    <section aria-label="章节顺序" className="space-y-3 rounded-xl border bg-card p-5">
      <div className="space-y-1">
        <h2 className="font-medium">章节顺序</h2>
        <p className="text-sm text-muted-foreground">
          读者目录按此顺序显示。调整只改变顺序，不改变正文、权限或发布状态；尚未发布的新章节发布后排在末尾。
        </p>
      </div>
      <ol className="divide-y rounded-lg border">
        {items.map((item, index) => (
          <li key={item.id} data-chapter-id={item.id} className="flex items-center gap-3 p-2 pl-3">
            <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            {item.status !== "published" && (
              <StatusBadge tone={TONE[item.status] ?? "neutral"}>{ADMIN_LABELS[item.status] ?? item.status}</StatusBadge>
            )}
            <Button type="button" size="icon" variant="ghost" aria-label={`上移「${item.title}」`}
              disabled={pending || index === 0} onClick={() => move(index, -1)}>
              <ArrowUpIcon />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label={`下移「${item.title}」`}
              disabled={pending || index === items.length - 1} onClick={() => move(index, 1)}>
              <ArrowDownIcon />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!changed || pending}
          onClick={() => start(async () => {
            const result = await orderChapters(seriesId, items.map((item) => item.id));
            setMessage(result.message);
            if (result.ok) router.refresh();
          })}>
          {pending ? "保存中…" : "保存顺序"}
        </Button>
        {changed && !pending && (
          <Button type="button" variant="ghost" onClick={() => { setItems(chapters); setMessage(""); }}>
            放弃调整
          </Button>
        )}
        <p role="status" className="text-sm">{message}</p>
      </div>
    </section>
  );
}
