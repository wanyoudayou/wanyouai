"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { EvaluationCase } from "@/lib/ai/evaluation-cases";
import type { QuestionDraft } from "@/lib/ai/knowledge-questions";

export function KnowledgeQuestionGenerator({ generationId, sourceRevision, settingsRevision, ready, disabled, onLoad, onBusyChange, onConfigure }: {
  generationId: string; sourceRevision: number; settingsRevision: string; ready: boolean; disabled: boolean;
  onLoad: (cases: EvaluationCase[]) => void; onBusyChange?: (busy: boolean) => void; onConfigure?: () => void;
}) {
  const [draft, setDraft] = useState<QuestionDraft | null>(null); const [busy, setBusy] = useState(false);
  const [known, setKnown] = useState(false);
  const [plan, setPlan] = useState<{ sourceRevision: number; connectionId: string; provider: string; bytes: number; manifest: { id: string; title?: string; target: string }[]; settingsRevision: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [consent, setConsent] = useState(false); const [retry, setRetry] = useState(false);
  const [message, setMessage] = useState("正在读取已有的问题草稿…");
  const lock = useRef(false); const live = useRef(true); const proceed = useRef(false);
  useEffect(() => {
    live.current = true; let current = true;
    const read = async (resource: string) => {
      const response = await fetch(`/api/admin/ai/index?resource=${resource}&id=${generationId}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      const data = await response.json(); if (!response.ok) throw new Error();
      return data;
    };
    Promise.all([read("draft"), ready ? read("question_plan") : Promise.resolve(null)]).then(([data, scope]) => {
      if (ready && (!scope?.plan || scope.plan.sourceRevision !== sourceRevision)) throw new Error();
      if (current) { setKnown(true); setPlan(scope?.plan ? { ...scope.plan, settingsRevision } : null); setConsent(false); setRetry(false); setDraft(data.draft?.source_revision === sourceRevision ? data.draft : null); setMessage(data.draft?.source_revision === sourceRevision ? "已读取保存的出题进度，没有调用模型。" : "可以自动准备问题，也可以直接手工编写。"); }
    }).catch(() => { if (current) setMessage("草稿状态暂未确认，请刷新页面后再生成，避免重复调用。"); });
    return () => { current = false; live.current = false; proceed.current = false; };
  }, [generationId, sourceRevision, settingsRevision, ready, refresh]);
  const scopeCurrent = !!plan && plan.sourceRevision === sourceRevision && plan.settingsRevision === settingsRevision;
  async function call(action: string, id: string, extra: Record<string, unknown> = {}) {
    const response = await fetch("/api/admin/ai/index", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, ...extra }), signal: AbortSignal.timeout(30000) });
    const data = await response.json(); if (!response.ok || !data.draft) throw new Error(data.message ?? "出题结果未确认，请先读取保存状态，不要直接重复生成。");
    if (live.current) setDraft(data.draft); return data.draft as QuestionDraft;
  }
  async function run() {
    if (lock.current || disabled || !known || !scopeCurrent || !ready || !consent || (draft?.state === "failed" && !retry)) return;
    lock.current = true; proceed.current = true; setBusy(true); onBusyChange?.(true);
    setMessage("正在按当前内容生成问题草稿，已完成的批次会保存。");
    try {
      let current = draft ?? await call("questions_start", generationId, { sourceRevision, connectionId: plan!.connectionId, requestId: crypto.randomUUID(), consent: true });
      while (proceed.current && live.current && current.state !== "complete") {
        current = await call(current.state === "failed" ? "questions_retry" : "questions_step", current.id, { consent: retry });
        if (current.state === "leased") { setMessage("请求仍在执行，请等候后刷新页面读取进度，不重复发送。"); return; }
      }
      if (current.state === "complete" && live.current) { onLoad(current.cases); setMessage("20 个问题草稿已生成。下一步：逐题确认答案来源，尚未开始检索预演。"); }
    } catch (error) {
      if (live.current) {
        setMessage(error instanceof Error ? error.message : "出题中断；已完成的批次会保留。");
        try {
          const response = await fetch(`/api/admin/ai/index?resource=draft&id=${generationId}`, { cache: "no-store" });
          const result = await response.json(); if (response.ok && live.current) setDraft(result.draft);
        } catch { /* Read failure never dispatches a replacement job. */ }
      }
    } finally { lock.current = false; setBusy(false); setConsent(false); setRetry(false); onBusyChange?.(false); }
  }
  return <section className="space-y-3 rounded-lg border p-3" aria-label="自动准备问题">
    <h5 className="font-medium">根据本站内容自动准备 20 个问题</h5>
    <p className="text-muted-foreground">10 个有答案问题、10 个库外问题。生成的是待核对草稿；答案来源由你确认，不会自动通过预演。</p>
    {!ready ? <><p>先配置并检查生成连接，才能自动出题；手工编写不需要此连接。</p><Button type="button" variant="outline" disabled={disabled} onClick={onConfigure}>配置生成连接</Button></> : draft?.state === "complete" ? <Button type="button" variant="outline" disabled={disabled} onClick={() => onLoad(draft.cases)}>使用已生成的问题草稿（不调用模型）</Button> : <>
      <p>将下列已索引内容分批发送至共享生成模型（{plan?.provider ?? "正在读取目标"}）。范围可能包含付费正文；本次 {plan?.manifest.length ?? "待确认"} 个片段，约 {plan ? (plan.bytes / 1024).toFixed(1) : "待确认"} KiB，每批最多 16 KiB。最多 3 次生成请求，可能计费。</p>
      {plan && <details><summary className="cursor-pointer">查看本次出题资料</summary><ul>{[...new Map(plan.manifest.map(item => [item.target, item.title ?? item.target])).entries()].map(([target, title]) => <li key={target}>{title}</li>)}</ul></details>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={disabled || busy} onChange={event => setConsent(event.target.checked)} className="mt-1" /><span>允许按上述范围发送本站资料并承担本次出题可能产生的费用。</span></label>
      {draft?.state === "failed" && <label className="flex items-start gap-2"><input type="checkbox" checked={retry} disabled={disabled || busy} onChange={event => setRetry(event.target.checked)} className="mt-1" /><span>未确认的请求可能已经计费，我确认仅重试未完成批次可能重复计费。</span></label>}
      <Button type="button" disabled={disabled || !known || !scopeCurrent || busy || !consent || (draft?.state === "failed" && !retry) || draft?.state === "leased"} onClick={run}>{busy ? "正在生成问题…" : draft ? "继续生成未完成的问题" : "生成问题草稿"}</Button>
      {busy && <Button type="button" variant="outline" onClick={() => { proceed.current = false; setMessage("当前请求完成后停止后续批次，进度会保存。"); }}>暂停后续出题</Button>}
    </>}
    {draft && <p>已保存 {draft.cases.length}/20 个问题草稿。</p>}
    {!busy && ready && <Button type="button" variant="ghost" disabled={disabled} onClick={() => { setKnown(false); setConsent(false); setRefresh(value => value + 1); }}>重新读取出题范围与进度</Button>}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
