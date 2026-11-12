"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { previewDraft } from "@/app/admin/content/actions";
export function PreviewPane({ markdown, access, onRestrict, disabled }: { markdown: string; access: string; onRestrict: () => void; disabled: boolean }) {
  const key = JSON.stringify([markdown, access]);
  const [preview, setPreview] = useState<{ key: string; result?: Awaited<ReturnType<typeof previewDraft>>; error?: string }>();
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      previewDraft(markdown, access).then((result) => { if (!stale) setPreview({ key, result }); })
        .catch(() => { if (!stale) setPreview({ key, error: "预览暂时不可用，请检查登录状态。" }); });
    }, 600);
    return () => { stale = true; clearTimeout(timer); };
  }, [key, markdown, access]);
  const current = preview?.key === key ? preview : undefined;
  return <section aria-label="匿名预览" className="min-w-0 rounded-lg border p-5">
    <h2 className="mb-5 text-lg font-medium">匿名预览</h2>
    {!current ? <p role="status" className="text-sm text-muted-foreground">正在更新预览…</p> : current.error ? <p role="alert" className="text-sm text-muted-foreground">{current.error}</p> : <>
      {current.result?.publicWithPaywall && <div className="mb-5 space-y-2 rounded-md border p-3 text-sm"><p>当前权限是「公开」，切点不会限制阅读，访客仍能看到全文。</p><Button type="button" size="sm" variant="outline" onClick={onRestrict} disabled={disabled}>改为付费可读</Button></div>}
      {current.result?.content}
      {current.result?.gated && <div className="mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">公开预览到此结束。后续正文需要相应阅读权限。</div>}
      {current.result?.diagnostics.map((item, i) => <p key={i} className="mt-3 text-sm text-muted-foreground">{item.message}</p>)}
    </>}
  </section>;
}
