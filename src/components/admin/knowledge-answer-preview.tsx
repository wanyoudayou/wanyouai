"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function KnowledgeAnswerPreview({ runId, index, disabled, settingsRevision }: { settingsRevision: string; runId: string; index: number; disabled: boolean }) {
  const [open, setOpen] = useState(false); const [view, setView] = useState("anonymous");
  const [consentRevision, setConsentRevision] = useState<string | null>(null); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const consent = !!settingsRevision && consentRevision === settingsRevision;
  const [message, setMessage] = useState(""); const [answer, setAnswer] = useState<{ text: string; sources: { title: string; url: string }[] } | null>(null);
  return <div className="space-y-3">
    {!open ? <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>预演问题 {index + 1} 的真实回答</Button> : <section className="space-y-3 rounded-md border p-3" aria-label={`问题 ${index + 1} 回答预演`}>
      <label className="block space-y-1">预演身份<select className="min-h-10 w-full rounded-md border bg-background px-2" value={view} disabled={busy} onChange={event => { setView(event.target.value); setConsentRevision(null); setAnswer(null); }}><option value="anonymous">匿名访客</option><option value="owner">站主本人</option></select></label>
      <p>按这份候选索引和所选身份预演，不创建会话或真实权益。最多调用一次查询向量和一次回答生成，可能计费；没有可读资料时不生成回答。</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={busy || disabled} onChange={event => setConsentRevision(event.target.checked ? settingsRevision : null)} className="mt-1" /><span>允许发送这道问题及该身份可读的资料，承担本次预演可能产生的费用。</span></label>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || disabled || !consent} onClick={async () => {
        if (lock.current || !consent) return; lock.current = true; setBusy(true); setConsentRevision(null); setMessage("正在预演本题，不会自动重试…");
        try {
          const response = await fetch("/api/admin/ai/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "answer_preview", id: runId, questionIndex: index, settingsRevision, requestId: crypto.randomUUID(), view, consent: true }), signal: AbortSignal.timeout(30000) });
          const data = await response.json(); if (!response.ok || !data.preview) throw new Error(data.message ?? "回答结果未确认，已停止；不要直接重复发送。");
          setAnswer(data.preview); setMessage("本题预演完成，结果仅供参考。");
        } catch (error) { setMessage(error instanceof Error ? error.message : "结果未确认，已停止。"); }
        finally { lock.current = false; setBusy(false); }
      }}>{busy ? "正在生成预演回答…" : "确认并预演本题"}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setOpen(false); setConsentRevision(null); }}>关闭回答预演</Button></div>
      <p role="status">{message}</p>
      {answer && <div className="space-y-2"><p className="whitespace-pre-wrap break-words">{answer.text}</p><ul>{answer.sources.map(source => <li key={source.url}><a className="underline" href={source.url}>{source.title}</a></li>)}</ul></div>}
    </section>}
  </div>;
}
