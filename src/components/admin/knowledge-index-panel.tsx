"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { KnowledgeEvaluationEditor } from "./knowledge-evaluation-editor";
import type { KnowledgeGeneration, KnowledgeStatus } from "@/lib/ai/knowledge";
import type { EvaluationCase } from "@/lib/ai/evaluation-cases";
import { currentCandidate, indexComplete, knowledgeStep, type KnowledgeEvaluationDetail, type KnowledgeMode, type KnowledgeReport } from "@/lib/ai/knowledge-workflow";

type Reply = { status: KnowledgeStatus; message?: string; id?: string; result?: { report?: KnowledgeReport } };
const names = ["准备内容与连接", "选择索引任务", "建立索引", "确认启用", "使用与更新"];
const modeNames = { initialize: "首次初始化", sync: "同步内容变化", rebuild: "全量重建" };
export function KnowledgeIndexPanel({ settingsRevision = "", available, disabled = false, generationReady = false, avatarEnabled = false, onBusyChange, onConfigure }: {
  settingsRevision?: string; available: boolean; disabled?: boolean; generationReady?: boolean; avatarEnabled?: boolean; onBusyChange?: (busy: boolean) => void; onConfigure?: () => void;
}) {
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [confirmed, setConfirmed] = useState(false); const [updatedAt, setUpdatedAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null); const [message, setMessage] = useState("正在读取知识库状态…");
  const [batching, setBatching] = useState(false);
  const [mode, setMode] = useState<KnowledgeMode | null>(null); const [planning, setPlanning] = useState(false);
  const [consentRevision, setConsentRevision] = useState<number | null>(null); const [retryConsent, setRetryConsent] = useState(false);
  const [consentConnection, setConsentConnection] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KnowledgeEvaluationDetail | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [acceptedGeneration, setAcceptedGeneration] = useState<string | null>(null);
  const [editingRunId, setEditingRunId] = useState<string | null>(null);
  const running = useRef(false); const mounted = useRef(true); const lock = useRef(false); const readId = useRef(0);
  const stepHeading = useRef<HTMLHeadingElement>(null); const previousStep = useRef(0);
  function restoreRun(snapshot: KnowledgeStatus) {
    const id = (currentCandidate(snapshot) ?? snapshot.generations.find(item => item.id === snapshot.activeGeneration))?.id;
    let saved: string | null = null;
    try { if (id) saved = window.localStorage.getItem(`wanyou:knowledge-check:${id}`); } catch { /* Storage is optional. */ }
    setSelectedRunId(current => snapshot.evaluations.some(run => run.id === current && run.generationId === id) ? current : saved);
  }
  async function request(action?: string, id?: string, extra: Record<string, unknown> = {}): Promise<Reply> {
    ++readId.current;
    const response = await fetch("/api/admin/ai/index", {
      ...(action ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, ...extra }) } : {}),
      cache: "no-store", signal: AbortSignal.timeout(30000),
    });
    let result: Reply;
    try { result = await response.json() as Reply; }
    catch { throw new Error("响应不完整，操作结果未确认。请刷新保存状态，不重复派发请求。"); }
    if (!response.ok || !result.status) throw new Error(result.message ?? "状态未确认，请刷新查看；不会自动重试。");
    if (mounted.current) { setStatus(result.status); restoreRun(result.status); setConfirmed(true); setUpdatedAt(new Date().toLocaleTimeString("zh-CN")); }
    return result;
  }
  // Read-only initialization: returning to the page never dispatches paid work.
  useEffect(() => {
    mounted.current = true; const id = ++readId.current;
    fetch("/api/admin/ai/index", { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(async response => {
      const result = await response.json() as Reply; if (!response.ok || !result.status) throw new Error();
      if (mounted.current && id === readId.current) { setStatus(result.status); restoreRun(result.status); setConfirmed(true); setUpdatedAt(new Date().toLocaleTimeString("zh-CN")); setMessage("已读取保存的进度。按当前步骤继续；刷新不会调用模型。"); }
    }).catch(() => { if (mounted.current && id === readId.current) { setConfirmed(false); setMessage("知识库状态暂时无法读取，请刷新重试；不代表零条或已经完成。"); } });
    return () => { mounted.current = false; running.current = false; };
  }, [available]);
  const candidate = status ? currentCandidate(status) : undefined;
  const active = status?.generations.find(item => item.id === status.activeGeneration);
  const working = candidate ?? active;
  const activationKey = `${candidate?.id}/${status?.sourceRevision}/${status?.selectedConnection}/${settingsRevision}`;
  const handleEditingChange = useCallback((editing: boolean) => {
    setEditingRunId(editing ? working?.id ?? null : null); setAcceptedGeneration(null);
  }, [working?.id]);
  const complete = !!status && !!candidate && indexComplete(status, candidate);
  const step = planning && !candidate ? 2 : status ? knowledgeStep(status, available) : 1;
  const selectedMode = !active ? "initialize" : active.connectionId !== status?.selectedConnection ? "rebuild" : mode ?? "sync";
  const consent = !!status && consentRevision === status.sourceRevision && consentConnection === status.selectedConnection;
  const blocked = !!busy || disabled || !confirmed;
  const matchesConnection = candidate?.connectionId === status?.selectedConnection;
  const runs = status?.evaluations.filter(run => run.generationId === working?.id) ?? [];
  const pendingRun = runs.find(run => run.sourceRevision === status?.sourceRevision && run.state !== "complete");
  const completedRuns = runs.filter(run => run.sourceRevision === status?.sourceRevision && run.state === "complete");
  const currentRun = pendingRun ?? completedRuns.find(run => run.id === selectedRunId) ?? (completedRuns.length === 1 ? completedRuns[0] : undefined);
  const candidateId = working?.id;
  function rememberRun(id: string) {
    setSelectedRunId(id);
    try { if (candidateId) window.localStorage.setItem(`wanyou:knowledge-check:${candidateId}`, id); } catch { /* Storage is optional; saved results remain on the server. */ }
  }
  const completeRunId = currentRun?.state === "complete" ? currentRun.id : null;
  useEffect(() => {
    if (!completeRunId) return;
    let live = true;
    fetch(`/api/admin/ai/index?resource=evaluation&id=${encodeURIComponent(completeRunId)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(async response => {
      const result = await response.json(); if (!response.ok || !result.evaluation) throw new Error();
      if (live) { setDetail(result.evaluation); setDetailError(""); }
    }).catch(() => { if (live) setDetailError("已保存的检查结果暂时无法读取。请重新读取结果，无需重跑检查。"); });
    return () => { live = false; };
  }, [completeRunId]);
  useEffect(() => {
    if (previousStep.current > 0 && step !== previousStep.current) stepHeading.current?.focus();
    previousStep.current = step;
  }, [step]);
  async function execute(label: string, work: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(label); onBusyChange?.(true); running.current = true; setMessage(label);
    try { await work(); }
    catch (error) {
      if (mounted.current) {
        const reason = error instanceof Error && !["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error.name) ? error.message : "请求结果未确认，已停止，不要直接重复操作。";
        try { await request(); setMessage(`${reason} 已重新读取保存的状态。`); }
        catch { setConfirmed(false); setMessage(`${reason} 请刷新状态后继续。`); }
      }
    } finally { lock.current = false; running.current = false; onBusyChange?.(false); if (mounted.current) { setBusy(null); setBatching(false); } }
  }
  async function build(generation: KnowledgeGeneration, snapshot: KnowledgeStatus) {
    setBatching(true);
    if (generation.connectionId !== snapshot.selectedConnection) throw new Error("向量连接已变化，已停止派发。请恢复候选使用的连接，或重新选择任务。");
    if (generation.approvedRevision !== snapshot.sourceRevision) await request("resume", generation.id, { consent, sourceRevision: snapshot.sourceRevision, connection: generation.connectionId });
    while (running.current && mounted.current) {
      const result = await request("step", generation.id);
      const current = result.status.generations.find(item => item.id === generation.id);
      if (!current) throw new Error("任务暂时无法确认，请刷新查看。");
      if (current.connectionId !== result.status.selectedConnection) throw new Error("向量连接已变化，已停止后续批次，请核对配置。");
      if (current.counts.failed) throw new Error("存在失败或结果未确认的片段。请刷新查看，再确认是否仅重试这些片段。");
      if (current.counts.leased) { setMessage("批次仍在执行。请稍后刷新确认，不重复派发；如超时未确认，将单独提示手动恢复。"); break; }
      if (indexComplete(result.status, current)) { setMessage("索引已生成。下一步：确认启用。也可以先做可选的问题测试，无需重新生成向量。"); break; }
    }
    if (!running.current && mounted.current) setMessage("已停止派发后续批次；已确认进度已保存，当前请求的结果仍以服务端为准。");
  }
  async function loadDetail(id: string) {
    const response = await fetch(`/api/admin/ai/index?resource=evaluation&id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const result = await response.json(); if (!response.ok || !result.evaluation) throw new Error("验收结果暂时无法读取，请稍后再查看；不必重新运行。");
    if (mounted.current) { setDetail(result.evaluation); setDetailError(""); }
    return result.evaluation as KnowledgeEvaluationDetail;
  }
  async function evaluate(existing?: string, cases?: EvaluationCase[], permission?: boolean) {
    if (!working) return;
    await execute("正在进行检索验收…", async () => {
      setBatching(true);
      const started = existing ? { id: existing } : await request("evaluation_start", working.id, { cases, consent: permission });
      const id = started.id!;
      // The acknowledged run owns the submitted draft; a stopped diagnostic must not block activation.
      setEditingRunId(null); setAcceptedGeneration(null);
      rememberRun(id);
      await continueEvaluation(id);
    });
  }
  async function continueEvaluation(id: string) {
    setBatching(true);
      try {
        while (running.current && mounted.current) {
          const result = await request("evaluation_step", id);
          const run = result.status.evaluations.find(item => item.id === id);
          if (!run) throw new Error("评测进度暂时无法确认，请刷新。");
          if (run.state === "failed") throw new Error("评测调用失败或未确认。确认可能重复计费后才能重试未完成批次。");
          if (run.state === "leased") { setMessage("评测批次仍在执行，请稍后刷新状态。不会自动重复调用。"); break; }
          if (run.state === "complete") {
            const result = await loadDetail(id);
            setMessage(result.report ? "检索检查已完成，结果仅供诊断参考。是否启用由你决定，不要求达到指定命中率。" : "检查结果暂不可读，不影响索引生成进度，请重新读取结果。");
            break;
          }
        }
      } finally { await loadDetail(id); }
  }
  const sourceConsent = <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={blocked || !available} checked={consent} onChange={event => { setConsentRevision(event.target.checked ? status!.sourceRevision : null); setConsentConnection(event.target.checked ? status!.selectedConnection : null); }} className="mt-1" /><span>允许将本次需要生成向量的文字（可能包含付费正文）发送至已保存的向量供应商，可能计费；内容或连接变化后重新确认。</span></label>;
  const currentDetail = detail?.id === currentRun?.id ? detail : null;
  return <section className="min-w-0 space-y-5 rounded-xl border bg-card p-4 sm:p-5" aria-label="知识库索引" aria-busy={!!busy}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">知识库配置与更新</h2><Button type="button" variant="ghost" disabled={!!busy} onClick={() => execute("正在刷新已保存的状态…", async () => { await request(); if (completeRunId) await loadDetail(completeRunId); setMessage("已读取最新进度，没有发送模型请求。"); })}>刷新状态</Button></div>
    <p role="status" aria-live="polite" className="text-sm leading-6">{message}</p>
    {!status ? <p className="text-sm">状态未读取或暂不可用，不能据此判断已完成。</p> : <>
      <ol className="grid gap-2 text-sm sm:grid-cols-5" aria-label="知识库设置步骤">{names.map((name, i) => <li key={name} aria-current={step === i + 1 ? "step" : undefined} className={`min-w-0 rounded-md p-2 ${step === i + 1 ? "bg-accent font-medium" : "text-muted-foreground"}`}>{i + 1}．{name}<span className="block text-xs">{step === i + 1 ? "当前步骤" : step > i + 1 ? "已完成" : "尚未开始"}</span></li>)}</ol>
      {active && <p className="text-sm"><StatusBadge tone="owned">当前使用的索引</StatusBadge> 更新完成前，仍用原索引中与当前文章一致的内容回答。</p>}
      {complete && step >= 4 && <p className="text-sm text-muted-foreground">已保存 {candidate!.counts.ready}/{candidate!.counts.total} 个向量片段，无需重新建立索引。</p>}
      <h3 ref={stepHeading} tabIndex={-1} className="font-semibold focus-visible:outline-2 focus-visible:outline-ring">{step}．{names[step - 1]}</h3>
      {step === 1 && <div className="space-y-3 text-sm">
        {!available ? <><p>先填写并保存向量连接，再完成连接检查。已经保存的 Key 不需要重新填写。</p><Button type="button" disabled={!!busy} onClick={onConfigure}>前往连接配置</Button></> : <><p>还没有可用的知识库内容。先发布至少一篇文章，再返回这里刷新状态。</p><Button asChild><Link href="/admin/articles">前往文章管理</Link></Button><p className="text-muted-foreground">使用自己的内容即可。仅需演示时，也可以在<Link className="underline" href="/admin/setup">部署检查</Link>导入使用指南。</p></>}
      </div>}
      {step === 2 && !candidate && <section className="space-y-4 text-sm" aria-label="选择索引任务">
        <p className="font-medium">{!active ? "首次建立本站知识库" : selectedMode === "sync" ? "同步新增、修改和失效的内容" : "重新建立全部知识库"}</p>
        <p>{!active ? "会处理下方范围内的全部内容，完成后由你确认启用。" : selectedMode === "sync" ? "自动复用未变化的向量，只处理内容变化。完成后由你决定切换使用；问题测试可选。" : "会重新生成全部向量，费用高于增量同步。新知识库启用前，原索引继续服务。"}</p>
        {active?.connectionId !== status.selectedConnection && active && <p>你已更换向量连接，需要全量重建。</p>}
        {active?.connectionId === status.selectedConnection && <details><summary className="cursor-pointer text-muted-foreground">高级：需要重新生成全部向量时</summary><label className="mt-3 flex items-start gap-2"><input type="checkbox" disabled={blocked} checked={selectedMode === "rebuild"} onChange={event => { setMode(event.target.checked ? "rebuild" : "sync"); setConsentRevision(null); }} />我需要全量重建，不复用已有向量</label></details>}
        <p>本次内容范围：{status.sourceCount} 个来源片段，约 {(status.sourceBytes / 1024).toFixed(1)} KiB 文字。包括已发布／暂停的文章和公开问答，不包含草稿、归档或私密会话。片段数不等于文章数。</p>
        {sourceConsent}
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={blocked || !available || !consent || status.sourceCount === 0} onClick={() => execute("正在准备索引任务…", async () => {
          const result = await request("start", undefined, { mode: selectedMode, consent, sourceRevision: status.sourceRevision, connection: status.selectedConnection });
          const target = result.status.generations.find(item => item.id === result.id);
          if (!target) throw new Error("任务创建结果未确认，请刷新状态。");
          setPlanning(false); setDetail(null); setDetailError("");
          if (target.state === "active") { setMessage("内容没有变化，无需更新；没有发送向量请求。"); return; }
          await build(target, result.status);
        })}>开始建立索引</Button>{active && planning && <Button type="button" variant="outline" disabled={blocked} onClick={() => { setPlanning(false); setConsentRevision(null); }}>取消本次更新</Button>}</div>
      </section>}
      {step === 3 && candidate && <section className="space-y-3 text-sm" aria-label="建立索引">
        <p><StatusBadge tone={candidate.counts.failed ? "paused" : "registered"}>{busy ? "正在建立知识库" : candidate.counts.failed ? "部分内容需要重试" : candidate.counts.leased ? "等待当前请求确认" : "任务已暂停"}</StatusBadge></p>
        <p>{candidate.scanComplete ? "来源扫描完成" : "正在扫描来源，片段总数尚未确定"} · 已保存 {candidate.counts.ready}/{candidate.counts.total} 个向量片段（复用 {candidate.reusedItems ?? 0} 个）</p>
        {candidate.scanComplete && <progress aria-label="向量生成进度" className="h-2 w-full accent-primary" max={Math.max(1, candidate.counts.total)} value={candidate.counts.ready} />}
        <p className="text-muted-foreground">待处理 {candidate.counts.pending} · 执行中 {candidate.counts.leased} · 失败／未确认 {candidate.counts.failed}。已保存的片段无需重新生成。</p>
        {candidate.approvedRevision !== status.sourceRevision && <><p>文章已变化，请确认新的发送范围后继续。</p>{sourceConsent}</>}
        {!matchesConnection && <><p>向量连接与该任务不一致。请恢复原连接后继续，或在底部取消此任务再重建。</p><Button type="button" variant="outline" disabled={!!busy} onClick={onConfigure}>前往连接配置</Button></>}
        {!busy && (candidate.counts.failed > 0 ? <><label className="flex items-start gap-2"><input type="checkbox" checked={retryConsent} disabled={blocked} onChange={event => setRetryConsent(event.target.checked)} className="mt-1" /><span>失败或未确认项可能已计费，手动重试可能产生重复费用。</span></label><Button type="button" disabled={blocked || !available || !matchesConnection || !retryConsent || (candidate.approvedRevision !== status.sourceRevision && !consent)} onClick={() => execute("仅重试未完成的向量片段…", async () => { setRetryConsent(false); const result = await request("retry", candidate.id, { consent: true }); await build(result.status.generations.find(item => item.id === candidate.id)!, result.status); })}>确认并仅重试失败项</Button></> : candidate.counts.leased > 0 ? <p>先等当前请求结束，再点击右上角“刷新状态”。此时不能重复发送。</p> : <Button type="button" disabled={blocked || !available || !matchesConnection || (candidate.approvedRevision !== status.sourceRevision && !consent)} onClick={() => execute("正在继续建立索引…", () => build(candidate, status))}>继续建立索引</Button>)}
      </section>}
      {step === 4 && candidate && complete && <section className="space-y-4 text-sm" aria-label="站主确认启用">
        <p>索引已完整生成。由你决定是否用于分身回答，可以直接启用，也可以先在下方检查检索效果。</p>
        <ul className="list-inside list-disc space-y-1 text-muted-foreground"><li>全部当前内容已生成向量：{candidate.counts.ready}/{candidate.counts.total}</li><li>内容版本与本次索引一致</li><li>{matchesConnection && available ? "向量连接已检查且与当前配置一致" : "连接不一致或不可用，请先修复连接"}</li></ul>
        <p className="text-muted-foreground">启用不代表回答准确率合格。正文仍按访客的阅读权限提供；无可读资料时不生成回答。</p>
        {editingRunId && <p>问题草稿尚未结束，请先取消编辑或下载并结束编辑，再确认启用，避免丢失草稿。</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={acceptedGeneration === activationKey} disabled={blocked || !!editingRunId || !available || !matchesConnection} onChange={event => setAcceptedGeneration(event.target.checked ? activationKey : null)} className="mt-1" /><span>我决定启用这份知识库，知悉检索可能错配或遗漏；问题测试仅供参考。</span></label>
        <Button type="button" disabled={blocked || !available || !matchesConnection || !!editingRunId || acceptedGeneration !== activationKey} onClick={() => execute("正在启用知识库…", async () => {
          await request("activate", candidate.id, { accept: true, sourceRevision: status.sourceRevision, connection: status.selectedConnection });
          setAcceptedGeneration(null); setMessage("知识库已启用。可以开启分身并到首页提问；以后同步内容无需重复做题。"); setPlanning(false);
        })}>确认启用这份知识库</Button>
      </section>}
      {step === 5 && <section className="space-y-3 text-sm" aria-label="启用与提问">
        {active && <>
          <StatusBadge tone="owned">知识库已启用</StatusBadge>
          <p>{!generationReady ? "下一步：配置并检查生成连接，让分身能组织回答。已有知识库会保留。" : !avatarEnabled ? "下一步：开启分身开关并保存，访客才能看到问答入口。" : "分身已就绪，可以到首页实际提问。匿名提问还需完成人机校验配置。"}</p>
          {!generationReady || !avatarEnabled ? <Button type="button" disabled={blocked} onClick={onConfigure}>{!generationReady ? "配置生成连接" : "前往开启分身"}</Button> : <Button asChild><Link href="/">到首页提问</Link></Button>}
          <div className="space-y-2 border-t pt-4"><h4 className="font-medium">以后发布或修改文章时</h4><p className="text-muted-foreground">发布或修改文章后，选择“同步内容变化”。同步完成后确认切换即可，不强制重新测试。建议保留真实失败问题，在更换模型、调整检索规则或新增重要内容时做对比检查；一次测试不能保证未来回答都正确。</p><Button type="button" variant="outline" disabled={blocked} onClick={() => { setPlanning(true); setMode(active.connectionId === status.selectedConnection ? "sync" : "rebuild"); setConsentRevision(null); }}>同步内容变化</Button></div>
        </>}
      </section>}
      {working && indexComplete(status, working) && (step === 4 || step === 5) && <details className="space-y-4 border-t pt-4" open={runs.length > 0}>
        <summary className="cursor-pointer font-medium">可选：检查检索效果</summary>
        <p className="text-sm text-muted-foreground">用真实问题查看能否找到相关资料。结果不限制启用，也不会训练向量；无需凑题数。可随时返回检查，额外调用前会确认费用。</p>
        {pendingRun ? <div className="space-y-3 text-sm">
          <StatusBadge tone={pendingRun.state === "failed" ? "paused" : "registered"}>{busy ? "正在检查问题" : pendingRun.state === "failed" ? "检查中断" : pendingRun.state === "leased" ? "等待当前请求确认" : "检查已暂停"}</StatusBadge>
          <p>已检查 {pendingRun.completed}/{pendingRun.total} 个问题。系统已保存问题和进度，继续时不需要重新导入，也不会重复处理已完成的批次。</p>
          <progress aria-label="问题检查进度" className="h-2 w-full accent-primary" max={Math.max(1, pendingRun.total)} value={pendingRun.completed} />
          {!busy && (pendingRun.state === "failed" ? <><label className="flex items-start gap-2"><input type="checkbox" checked={retryConsent} disabled={blocked} onChange={event => setRetryConsent(event.target.checked)} className="mt-1" /><span>未确认的评测可能已计费，我确认重试可能产生重复费用。</span></label><Button type="button" disabled={blocked || !available || !retryConsent} onClick={() => execute("正在继续未完成的问题检查…", async () => {
            setRetryConsent(false); await request("evaluation_retry", pendingRun.id, { consent: true });
            // The outer operation owns the lock; continue the same saved run directly.
            await continueEvaluation(pendingRun.id);
          })}>重试并继续未完成的问题</Button></> : pendingRun.state === "leased" ? <p>先等当前请求结束，再刷新状态。暂时不能重复检查。</p> : <Button type="button" disabled={blocked || !available} onClick={() => evaluate(pendingRun.id)}>继续这次检查</Button>)}
        </div> : !currentRun && completedRuns.length > 1 ? <div className="space-y-3 text-sm"><p>找到 {completedRuns.length} 份已完成的检查。本浏览器尚未记录你正在查看哪一份，请选择结果；只读取已有记录，不会再次检查或计费。</p><div className="flex flex-wrap gap-2">{completedRuns.map(run => <Button type="button" variant="outline" key={run.id} disabled={blocked} onClick={() => rememberRun(run.id)}>查看检查 {run.id.slice(0, 8)}（{run.completed}/{run.total}）</Button>)}</div></div> : currentRun && !currentDetail ? <div className="space-y-3 text-sm"><p>{detailError || "正在读取这次保存的检查结果…"}</p>{detailError && <Button type="button" variant="outline" disabled={blocked} onClick={() => execute("正在读取结果…", () => loadDetail(currentRun.id))}>重新读取结果</Button>}</div> : <>
          <KnowledgeEvaluationEditor settingsRevision={settingsRevision} disabled={blocked} eligible={["building", "ready", "active"].includes(working!.state) && working?.connectionId === status?.selectedConnection && available} detail={currentDetail} generationId={working!.id} sourceRevision={status.sourceRevision} sourceBytes={status.sourceBytes} generationReady={generationReady} onConfigure={onConfigure} onBusyChange={onBusyChange} onEditingChange={handleEditingChange} onStart={(cases, permission) => evaluate(undefined, cases, permission)} />
        </>}
      </details>}
      {busy && batching && <div className="space-y-2 text-sm"><p>请保持此页打开；关闭后停止派发后续批次，已保存的进度不会丢失。</p><Button type="button" variant="outline" onClick={() => { running.current = false; setMessage("当前请求结束后停止，已发送的请求仍可能完成和计费。"); }}>暂停后续处理</Button></div>}
      <details className="space-y-3 border-t pt-4 text-sm"><summary className="cursor-pointer text-muted-foreground">高级：进度记录与任务清理</summary>
        <p>已发布来源 {status.sourceCount} 个片段，约 {(status.sourceBytes / 1024).toFixed(1)} KiB；状态读取时间 {updatedAt || "未确认"}。</p>
        <p>只移除索引及其检查记录，不删除文章。移除未完成任务会失去其已生成的向量，再建可能产生费用。</p>
        {status.generations.map(item => <div key={item.id} className="flex flex-wrap items-center gap-2"><span>{item.id.slice(0, 8)} · {modeNames[item.mode ?? "rebuild"]} · {item.state === "active" ? "正在使用" : item.state === "retired" ? "历史索引" : item.state === "ready" ? "已生成，待启用" : indexComplete(status, item) ? "已生成，待启用" : "未完成"}</span>{item.state !== "active" && <Button type="button" size="sm" variant="outline" disabled={blocked} onClick={() => setRemoveId(item.id)}>移除此索引</Button>}</div>)}
        {removeId && <div role="group" aria-label="确认移除索引" className="space-y-3 rounded-md border p-3"><p>移除索引 {removeId.slice(0, 8)} 及其检查记录？该索引已保存的向量也会删除，文章和当前使用的索引不变。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={blocked} onClick={() => setRemoveId(null)}>保留索引</Button><Button type="button" variant="destructive" disabled={blocked} onClick={() => execute("正在移除索引…", async () => { await request("discard", removeId); setRemoveId(null); setDetail(null); setMessage("所选索引已移除，文章未改变。"); })}>确认移除该索引</Button></div></div>}
      </details>
    </>}
  </section>;
}
