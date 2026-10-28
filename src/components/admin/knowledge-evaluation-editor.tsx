"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { evaluationCases, type EvaluationCase } from "@/lib/ai/evaluation-cases";
import { KNOWLEDGE_EVALUATION_EXAMPLE } from "@/lib/ai/evaluation-example";
import { rankedMatches, sourceTitle } from "@/lib/ai/evaluation-result";
import { evaluationIssue, type KnowledgeEvaluationDetail, type KnowledgeSourceChoice } from "@/lib/ai/knowledge-workflow";
import { KnowledgeEvaluationReport } from "./knowledge-evaluation-report";
import { KnowledgeQuestionGenerator } from "./knowledge-question-generator";

const selectClass = "min-h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const blank = (): EvaluationCase => ({ question: "", expected: [], split: "train", reviewed: false });
export function KnowledgeEvaluationEditor({ disabled, eligible, onStart, detail, generationId, sourceRevision = 0, generationReady = false, onBusyChange, onConfigure, onEditingChange, settingsRevision = "" }: {
  disabled: boolean; eligible: boolean; onStart: (cases: EvaluationCase[], consent: boolean) => void;
  detail: KnowledgeEvaluationDetail | null;
  settingsRevision?: string; generationId?: string; sourceRevision?: number; sourceBytes?: number; generationReady?: boolean;
  onBusyChange?: (busy: boolean) => void; onConfigure?: () => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [cases, setCases] = useState<EvaluationCase[]>([]);
  const [draftRun, setDraftRun] = useState<string | null>(null);
  const [editingRun, setEditingRun] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [page, setPage] = useState(1); const [query, setQuery] = useState("");
  const [sources, setSources] = useState<KnowledgeSourceChoice[]>([]);
  const [sourceMessage, setSourceMessage] = useState("正在读取可选文章…");
  const [sourceBusy, setSourceBusy] = useState(false); const searchId = useRef(0);
  const sourceMounted = useRef(true); const editor = useRef<HTMLHeadingElement>(null);
  const [consent, setConsent] = useState(false); const [json, setJson] = useState("");
  const [message, setMessage] = useState("");
  const [cancelAsked, setCancelAsked] = useState(false);
  const [baseline, setBaseline] = useState<EvaluationCase[] | null>(null);
  const [baselineMessage, setBaselineMessage] = useState("");
  const [replacement, setReplacement] = useState<{ name: string; cases: EvaluationCase[] } | null>(null);
  const editing = !detail || editingRun === detail.id;
  const unchanged = !!detail && JSON.stringify(cases.map(item => [item.question, item.expected])) === JSON.stringify(detail.cases.map(item => [item.question, item.expected]));
  const hasDraft = !!detail && draftRun === detail.id && !unchanged;
  const editingDraft = hasDraft || (editing && cases.length > 0);
  useEffect(() => { onEditingChange?.(editingDraft); }, [editingDraft, onEditingChange]);
  const sourceTitles = { ...detail?.sourceTitles, ...Object.fromEntries(sources.map(source => [source.target, source.title])) };
  useEffect(() => {
    if (!generationId || detail) return;
    let live = true;
    fetch(`/api/admin/ai/index?resource=baseline&id=${generationId}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "上次问题暂不可读。");
      if (live) { setBaseline(result.baseline?.cases ?? null); setBaselineMessage(result.baseline?.missing ? "部分原答案来源已失效，沿用问题后只需重新核对标记的题目；可按实际内容修正题目标注。" : result.baseline ? "可以沿用上次的问题比较效果，也可以跳过测试；检查仍可能产生向量调用费用。" : ""); }
    }).catch(error => { if (live) setBaselineMessage(error instanceof Error ? error.message : "上次问题暂不可读，请稍后刷新。"); });
    return () => { live = false; };
  }, [generationId, detail]);
  useEffect(() => {
    let live = true; sourceMounted.current = true; const id = ++searchId.current;
    fetch("/api/admin/ai/index?resource=sources", { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(async response => {
      const result = await response.json(); if (!response.ok || !Array.isArray(result.sources)) throw new Error();
      if (live && id === searchId.current) { setSources(result.sources); setSourceMessage("未找到需要的文章时，可按标题搜索；已选择的文章会保留。"); }
    }).catch(() => { if (live) setSourceMessage("文章列表读取失败，可在下方重新搜索。"); });
    return () => { live = false; sourceMounted.current = false; };
  }, []);
  useEffect(() => {
    if (!(hasDraft || (editing && cases.length > 0 && !unchanged))) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", leave); return () => window.removeEventListener("beforeunload", leave);
  }, [editing, cases.length, unchanged, hasDraft]);
  function focusEditor(index = 0) {
    requestAnimationFrame(() => {
      const input = document.getElementById(`evaluation-question-${index}`);
      (input ?? editor.current)?.focus(); (input ?? editor.current)?.scrollIntoView({ block: "center" });
    });
  }
  function replace(next: EvaluationCase[]) { setCases(next); setConsent(false); setReview(false); }
  function change(index: number, value: Partial<EvaluationCase>) {
    replace(cases.map((item, i) => i === index ? { ...item, ...value, ...(value.question !== undefined && value.question !== item.question ? { reviewed: false } : {}) } : item));
  }
  function beginEdit(index: number) {
    // The saved result is immutable; edits are a separate draft with an explicit purpose.
    if (draftRun !== detail!.id) replace(detail!.cases.map(item => ({ ...item, expected: [...item.expected] })));
    setDraftRun(detail!.id);
    onEditingChange?.(true);
    setEditingRun(detail!.id); setPage(Math.floor(index / 10) + 1); setMessage(""); focusEditor(index);
  }
  function adoptSource(index: number, target: string) {
    if (!detail || detail.state !== "complete" || disabled || !eligible || !rankedMatches(detail.results[index] ?? [], detail.report?.threshold ?? -1).some(match => match.target === target)) return;
    const current = draftRun === detail.id ? cases : detail.cases;
    const draftIndex = current.findIndex(item => item.question === detail.cases[index]?.question);
    const item = current[draftIndex];
    if (!item || item.expected.includes(target) || item.expected.length >= 3) return;
    replace(current.map((value, i) => ({ ...value, expected: i === draftIndex ? [...value.expected, target] : [...value.expected] })));
    setDraftRun(detail.id); setCancelAsked(false); onEditingChange?.(true);
    setMessage(`已将《${sourceTitle(target, detail.sourceTitles)}》加入问题 ${index + 1} 的可接受来源，原来源保留。${!item.expected.length ? "该题由“本站没有答案”改为有答案，请核对该标注。" : ""}仅本页草稿更新，原报告不变；可继续核对其他来源。`);
  }
  function importQuestions(name: string, next: EvaluationCase[]) {
    if (cases.length) { setReplacement({ name, cases: next }); return; }
    replace(next); setPage(1); setMessage("问题已放入下方编辑区，尚未发送。请核对问题与本站内容。"); focusEditor();
  }
  let invalid = "";
  try { evaluationCases(cases); } catch (error) { invalid = evaluationIssue(error instanceof Error ? error.message : ""); }
  const pages = Math.max(1, Math.ceil(cases.length / 10)); const currentPage = Math.min(page, pages);
  function exportQuestions() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(cases, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "knowledge-evaluation.json"; link.click(); URL.revokeObjectURL(url);
  }
  function cancelEdit() {
    if (!unchanged && !cancelAsked) { setCancelAsked(true); return; }
    replace(detail ? detail.cases.map(item => ({ ...item, expected: [...item.expected] })) : []); setEditingRun(null); setDraftRun(null); setCancelAsked(false);
    onEditingChange?.(false);
  }
  const cancelConfirmation = cancelAsked && <div role="group" aria-label="确认取消问题编辑" className="space-y-2 rounded-md border p-3"><p>放弃本次未提交的问题草稿？已保存报告、文章和索引不变。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setCancelAsked(false)}>继续编辑问题</Button><Button type="button" onClick={cancelEdit}>放弃本次修改</Button><Button type="button" variant="ghost" onClick={exportQuestions}>先下载问题草稿</Button></div></div>;
  if (!editing && detail) return <div className="min-w-0 space-y-4">
    <KnowledgeEvaluationReport settingsRevision={settingsRevision} detail={detail} disabled={disabled || !eligible} onEdit={detail.state === "complete" ? beginEdit : undefined} draftCases={draftRun === detail.id ? cases : undefined} onAdopt={detail.state === "complete" ? adoptSource : undefined} />
    {hasDraft && <section aria-label="已采纳来源的问题草稿" className="space-y-3 rounded-lg border p-4 text-sm">
      <p className="font-medium">问题草稿已修改，原报告仍保留原来的命中率。</p>
      <p>采纳只表示你确认该来源包含答案，不代表系统回答正确。草稿仅保留在本页，可先下载备份；重新检查前会单独确认费用。</p>
      {invalid && <p>{invalid}</p>}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled || !eligible || !!invalid || cancelAsked} onClick={() => { setEditingRun(detail.id); setReview(true); setConsent(false); focusEditor(); }}>下一步：确认检查范围</Button><Button type="button" variant="outline" onClick={exportQuestions}>下载问题草稿</Button><Button type="button" variant="outline" disabled={disabled} onClick={cancelEdit}>取消编辑问题</Button></div>
    </section>}
    {cancelConfirmation}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>;
  return <div className="min-w-0 space-y-4 text-sm">
    <h4 ref={editor} tabIndex={-1} className="font-semibold">{review ? "确认本次检查" : detail ? "修改这次检查的问题" : "准备检查问题"}</h4>
    {review ? <>
      <p>将把下方确认的 {cases.length} 个问题发送给知识库使用的向量供应商，检查能否找到正确文章。可能产生 API 费用；本次不生成回答，也不重新发送文章正文。</p>
      <p>有答案 {cases.filter(item => item.expected.length).length} 个；本站没有答案 {cases.filter(item => !item.expected.length).length} 个。结果仅供参考，不影响启用，也不改变检索规则或向量。</p>
      {detail && <p>这是一次新的检查，原检查结果保留。问题已修改，需要重新检查整组问题。</p>}
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={disabled || !eligible} onChange={event => setConsent(event.target.checked)} className="mt-1" /><span>允许发送这 {cases.length} 个问题并承担供应商可能收取的费用。</span></label>
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled || !eligible || !consent || !!invalid || unchanged} onClick={() => { setConsent(false); onStart(evaluationCases(cases), true); }}>确认并开始检查</Button><Button type="button" variant="outline" disabled={disabled} onClick={() => { setReview(false); setConsent(false); focusEditor(); }}>返回修改问题</Button></div>
    </> : <>
      <p>准备你关心的真实问题，逐题确认答案来源后运行检查。1–100 题均可，无需分组；测试可跳过，启用由你决定。</p>
      <p className="text-muted-foreground">问题应对应已经发布并建立索引的内容。预演用于检查这组问题的效果，不能保证未来所有问题都能正确回答。</p>
      {detail && <p className="text-muted-foreground">这里仅编辑诊断用的问题和可接受来源，不会修改文章、向量或检索规则。题目标注本来正确时，应保留失败样例，改进正文或检索实现后再用相同问题对比。</p>}
      {baselineMessage && <p>{baselineMessage}</p>}
      {baseline && <Button type="button" variant="outline" disabled={disabled} onClick={() => importQuestions("上次已确认的问题", baseline)}>沿用上次问题进行回归（{baseline.length} 题）</Button>}
      {generationId && <details open={cases.length === 0} className="space-y-3"><summary className="cursor-pointer font-medium">自动准备问题草稿</summary><KnowledgeQuestionGenerator generationId={generationId} sourceRevision={sourceRevision} settingsRevision={settingsRevision} ready={generationReady} disabled={disabled} onBusyChange={onBusyChange} onConfigure={onConfigure} onLoad={next => importQuestions("自动生成的问题草稿", next)} /></details>}
      {cases.length === 0 && <Button type="button" variant="outline" disabled={disabled} onClick={() => { replace([blank()]); focusEditor(); }}>手工编写本站的问题</Button>}
      {cases.length > 0 && <>
        <p>{cases.length} 个问题 · 已确认 {cases.filter(item => item.reviewed !== false).length}/{cases.length} · 有答案 {cases.filter(item => item.reviewed !== false && item.expected.length).length} 题 · 本站没有答案 {cases.filter(item => item.reviewed !== false && !item.expected.length).length} 题</p>
        <details className="space-y-3"><summary className="cursor-pointer">查找其他文章</summary>
          <label className="block space-y-1">按标题查找预期来源<Input value={query} maxLength={120} disabled={disabled} onChange={event => setQuery(event.target.value)} placeholder="输入文章标题" /></label>
          <Button type="button" variant="outline" disabled={disabled || sourceBusy} onClick={async () => {
            const id = ++searchId.current; setSourceBusy(true);
            try {
              const response = await fetch(`/api/admin/ai/index?resource=sources&q=${encodeURIComponent(query)}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
              const result = await response.json(); if (!response.ok || !Array.isArray(result.sources)) throw new Error();
              if (sourceMounted.current && id === searchId.current) { setSources(current => [...new Map([...current, ...result.sources].map(item => [item.target, item])).values()]); setSourceMessage(result.sources.length ? `找到 ${result.sources.length} 个来源，已加入问题下方的选择器。` : "没有匹配的文章，请换一个标题搜索。"); }
            } catch { if (sourceMounted.current && id === searchId.current) setSourceMessage("读取失败，请稍后重新搜索。"); }
            finally { if (sourceMounted.current && id === searchId.current) setSourceBusy(false); }
          }}>{sourceBusy ? "正在查找…" : "查找来源"}</Button>
          <p role="status" className="text-muted-foreground">{sourceMessage}</p>
        </details>
        <div className="space-y-3">{cases.slice((currentPage - 1) * 10, currentPage * 10).map((item, offset) => {
          const index = (currentPage - 1) * 10 + offset;
          return <fieldset key={index} disabled={disabled} className="min-w-0 space-y-3 rounded-lg border p-3">
            <legend className="px-1">问题 {index + 1}</legend>
            <label className="block space-y-1">问题内容<textarea id={`evaluation-question-${index}`} aria-label={`问题 ${index + 1} 内容`} rows={2} maxLength={1024} className={`${selectClass} p-2`} value={item.question} onChange={event => change(index, { question: event.target.value })} /></label>
            {item.evidence && <details className="space-y-2"><summary className="cursor-pointer text-muted-foreground">查看出题依据，核对后再选择答案</summary><p className="whitespace-pre-wrap">{item.evidence}</p>{item.suggestedTarget && <p>建议核对：{item.suggestedTitle ?? sources.find(source => source.target === item.suggestedTarget)?.title ?? item.suggestedTarget}</p>}</details>}
            <div className="min-w-0">
              <label className="block min-w-0 space-y-1">哪篇文章包含答案？<select aria-label={`问题 ${index + 1} 预期来源`} className={selectClass} value={item.reviewed === false ? "__unreviewed" : item.expected[0] ?? ""} onChange={event => change(index, { expected: event.target.value ? [event.target.value] : [], reviewed: true })}>
                <option value="__unreviewed" disabled>尚未核对，请选择文章或本站没有答案</option>
                <option value="">本站没有答案</option>
                {item.suggestedTarget && !sources.some(source => source.target === item.suggestedTarget) && !item.expected.includes(item.suggestedTarget) && <option value={item.suggestedTarget}>{item.suggestedTitle ?? item.suggestedTarget}（出题依据，请核对）</option>}
                {item.expected.filter(target => !sources.some(source => source.target === target)).map(target => <option key={target} value={target}>{detail?.sourceTitles?.[target] ?? target.replace("article:", "文章：")}（请核对）</option>)}
                {sources.map(source => <option key={source.target} value={source.target}>{source.title}</option>)}
              </select>{item.expected.length > 1 && <p className="text-xs text-muted-foreground">重新选择会替换下方全部来源；需要保留其他来源时，单独移除。</p>}</label>
              {item.expected.length > 0 && <ul aria-label={`问题 ${index + 1} 的可接受来源`} className="mt-2 space-y-2">{item.expected.map(target => <li key={target} className="flex min-w-0 flex-wrap items-center gap-2"><span className="min-w-0 break-words">{sourceTitle(target, sourceTitles)}</span><Button type="button" size="sm" variant="ghost" aria-label={`从问题 ${index + 1} 移除${sourceTitle(target, sourceTitles)}`} onClick={() => change(index, { expected: item.expected.filter(value => value !== target), reviewed: true })}>移除此来源</Button></li>)}</ul>}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => replace(cases.filter((_, i) => i !== index))}>移除此问题</Button>
          </fieldset>;
        })}</div>
        <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={disabled || cases.length >= 100} onClick={() => { replace([...cases, blank()]); setPage(Math.ceil((cases.length + 1) / 10)); focusEditor(cases.length); }}>添加问题</Button>
          <Button type="button" variant="outline" onClick={exportQuestions}>下载问题草稿</Button>
          {pages > 1 && <><Button type="button" variant="outline" disabled={disabled || currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页问题</Button><span>{currentPage}/{pages}</span><Button type="button" variant="outline" disabled={disabled || currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页问题</Button></>}
        </div>
        <p className="text-xs text-muted-foreground">未提交的修改仅保留在本页，离开前可下载问题草稿。</p>
      </>}
      <details className="space-y-3"><summary className="cursor-pointer font-medium">可选：用使用指南问题作为起点</summary>
        <p className="text-muted-foreground">只有本站已导入并保留默认使用指南时才适用。这是待核对的问题草稿；不会导入文章，不会调用模型。使用自己的内容时直接跳过。</p>
        <Button type="button" variant="outline" disabled={disabled} onClick={() => importQuestions("使用指南问题", KNOWLEDGE_EVALUATION_EXAMPLE.map(item => ({ ...item, expected: [], suggestedTarget: item.expected[0], reviewed: false })) as EvaluationCase[])}>使用指南问题作为起点</Button>
      </details>
      <details className="space-y-3"><summary className="cursor-pointer font-medium">高级：导入问题文件内容</summary>
        <p className="text-muted-foreground">将已下载的问题 JSON 粘贴到这里；只导入检查问题，不导入文章。</p>
        <textarea aria-label="知识库评测问题 JSON" rows={6} disabled={disabled} className={`${selectClass} p-2 font-mono text-xs`} value={json} onChange={event => setJson(event.target.value)} />
        <Button type="button" variant="outline" disabled={disabled} onClick={() => { try { importQuestions("导入的问题", evaluationCases(JSON.parse(json))); } catch (error) { setMessage(error instanceof SyntaxError ? "JSON 格式无效。" : evaluationIssue(error instanceof Error ? error.message : "")); } }}>导入问题</Button>
      </details>
      {replacement && <div role="group" aria-label="确认替换问题草稿" className="space-y-3 rounded-md border p-3"><p>用“{replacement.name}”的 {replacement.cases.length} 个问题替换正在编辑的 {cases.length} 个问题？此操作只改变本页草稿，已保存结果和文章不变。</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setReplacement(null)}>保留当前草稿</Button><Button type="button" disabled={disabled} onClick={() => { replace(replacement.cases); setReplacement(null); setPage(1); focusEditor(); }}>确认替换问题草稿</Button></div><Button type="button" variant="ghost" onClick={exportQuestions}>先下载当前草稿</Button></div>}
      {cases.length > 0 && <><p className="text-muted-foreground">{unchanged ? "问题尚未修改，无需重复检查相同的问题。" : invalid || "问题已核对，下一步确认发送范围和费用。"}</p><div className="flex flex-wrap gap-2"><Button type="button" disabled={disabled || !eligible || !!invalid || unchanged || !!replacement || cancelAsked} onClick={() => { setReview(true); setConsent(false); focusEditor(); }}>下一步：确认检查范围</Button>{!detail && <Button type="button" variant="outline" disabled={disabled} onClick={cancelEdit}>取消编辑问题</Button>}{detail && <><Button type="button" variant="outline" disabled={disabled} onClick={() => { setEditingRun(null); setConsent(false); setReview(false); setCancelAsked(false); onEditingChange?.(hasDraft); }}>保留草稿，核对其他检索来源</Button><Button type="button" variant="outline" disabled={disabled} onClick={cancelEdit}>取消编辑问题</Button></>}</div></>}
      {cancelConfirmation}
    </>}
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
