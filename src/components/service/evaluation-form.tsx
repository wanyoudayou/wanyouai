"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** 结案订单的评价表单：1–5 星 + 文字（选填）。 */
export function EvaluationForm({ bookingId }: { bookingId: number }) {
  const [rating, setRating] = useState(5);
  const [content, setContent] = useState("");
  const [state, setState] = useState<{
    pending: boolean;
    message: string;
    ok: boolean;
  }>({ pending: false, message: "", ok: false });

  const submit = async () => {
    setState({ pending: true, message: "", ok: false });
    try {
      const res = await fetch("/api/services/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId, rating, content }),
      });
      const data = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      setState({
        pending: false,
        message: data?.message ?? (res.ok ? "感谢评价。" : "提交失败。"),
        ok: res.ok,
      });
    } catch {
      setState({
        pending: false,
        message: "网络异常，请稍后再试。",
        ok: false,
      });
    }
  };

  if (state.ok)
    return (
      <p role="status" className="text-sm">
        {state.message}
      </p>
    );
  return (
    <div className="space-y-3">
      <div
        className="flex items-center gap-1"
        role="radiogroup"
        aria-label="评分"
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={`${star} 星`}
            onClick={() => setRating(star)}
            className={`text-2xl leading-none ${star <= rating ? "text-warning" : "text-muted-foreground/30"}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="这次合作哪里好、哪里可以更好？（选填，公开展示）"
        className="block w-full rounded-md border bg-background p-2 text-sm"
      />
      <Button size="sm" onClick={submit} disabled={state.pending}>
        {state.pending ? "提交中…" : "提交评价"}
      </Button>
      {state.message && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}
