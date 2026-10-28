"use client";
import { useState } from "react";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";
import type { EvaluationCase } from "@/lib/ai/evaluation-cases";
import { evaluationFindings, sourceTitle } from "@/lib/ai/evaluation-result";
import { evaluationIssue, type KnowledgeEvaluationDetail } from "@/lib/ai/knowledge-workflow";
import { KnowledgeAnswerPreview } from "./knowledge-answer-preview";

export function KnowledgeEvaluationReport({ detail, disabled, onEdit, draftCases, onAdopt, settingsRevision = "" }: {
  settingsRevision?: string; detail: KnowledgeEvaluationDetail; disabled: boolean; onEdit?: (index: number) => void;
  draftCases?: EvaluationCase[]; onAdopt?: (index: number, target: string) => void;
}) {
  const [all, setAll] = useState(false); const [page, setPage] = useState(1);
  const finding = evaluationFindings(detail);
  const complete = detail.state === "complete";
  const failed = complete && finding.attention.length > 0;
  const selected = all || !finding.attention.length ? finding.rows : finding.attention;
  const pages = Math.max(1, Math.ceil(selected.length / 5)); const currentPage = Math.min(page, pages);
  return <section aria-label="检索验收结果" className="space-y-4 text-sm">
    <div className="space-y-2">
      <StatusBadge tone={complete ? "registered" : "paused"}>{complete ? "检查完成 · 仅供参考" : "检查尚未完成"}</StatusBadge>
      <h4 className="font-semibold">查看错配与遗漏，启用由你决定</h4>
      <p>已检查 {detail.results.length}/{detail.cases.length} 个问题。</p>
      {detail.issue && <p>{evaluationIssue(detail.issue)}</p>}
      {detail.report && <>
        {detail.report.positiveCases !== undefined ? <p>有答案题命中 {detail.report.hits}/{detail.report.positiveCases}，{detail.report.positiveCases ? `命中率 ${((detail.report.recall ?? 0) * 100).toFixed(0)}%` : "本组没有有答案题，不计算命中率"}。</p> : <p>历史独立子集命中率 {((detail.report.holdoutRecall ?? 0) * 100).toFixed(0)}%。</p>}
        <p>标注为本站没有答案，却返回来源：{detail.report.falsePositives ?? detail.report.holdoutFalsePositives ?? 0}/{detail.report.negativeCases ?? "—"} 题。请核对来源是否确实包含答案；返回来源不代表已生成回答。</p>
        <p className="text-muted-foreground">这是这组问题的来源检索结果，不是回答正确率，不设启用分数门槛。修改题目或采纳来源只改变诊断标注，不训练向量。</p>
        {detail.report.policyVersion !== 3 && <p className="text-muted-foreground">这份历史报告保留当时的问题、筛选规则和结果，仅供参考；新测试使用当前固定规则，不根据题目标注调整。</p>}
      </>}
      {failed && <div className="space-y-2 rounded-lg border border-warning/50 bg-warning/5 p-3"><p>先核对下方高亮的错配。问题和预期来源正确时，保留原题；到<Link className="underline" href="/admin/articles">文章管理</Link>补充缺失答案、清晰标题和上下文，发布后同步索引，再用相同问题对比。相同正文用同一模型重建不能保证改善。</p><p>仅在题目或来源标注确实错误时编辑；不要为了提高分数修改正确的题目。</p></div>}
      {onEdit && <Button type="button" variant="outline" disabled={disabled} onClick={() => onEdit(finding.attention[0]?.index ?? 0)}>{draftCases ? "编辑问题草稿" : "编辑诊断问题"}</Button>}
      {onEdit && <p className="text-xs text-muted-foreground">只修改这组诊断问题和预期来源，原报告保留；不会改进知识库或直接提高原报告分数。</p>}
      {!finding.thresholdKnown && <p className="text-muted-foreground">下方展示的是待筛选的候选来源。检索标准尚未确定，出现候选来源不等于“已命中”，也不能据此认定库外问题检查失败。</p>}
    </div>
    <details className="space-y-3" open={finding.attention.length > 0}>
      <summary className="cursor-pointer font-medium">{finding.attention.length ? `需要核对 ${finding.attention.length} 个问题` : "查看逐题结果"}</summary>
      {onAdopt && <p className="text-muted-foreground">只有确认某个来源确实包含答案时，才采纳为可接受来源。采纳会加入问题草稿，保留原来源和这份报告；不会立即提高命中率或启用知识库。</p>}
      {finding.attention.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={event => { setAll(event.target.checked); setPage(1); }} />显示全部 {detail.cases.length} 个问题</label>}
      <ol className="space-y-4">{selected.slice((currentPage - 1) * 5, currentPage * 5).map(row => {
        const item = detail.cases[row.index];
        const draft = draftCases ? draftCases.find(value => value.question === item.question) : item;
        return <li key={row.index} className={cn("min-w-0 space-y-2", row.problem ? "rounded-lg border border-warning/50 bg-warning/5 p-4" : "border-b pb-4")}>
          <p className="font-medium">问题 {row.index + 1}：{item.question}</p>
          {row.problem ? <StatusBadge tone="paused"><TriangleAlertIcon aria-hidden />{row.label}</StatusBadge> : <p>{row.label}</p>}
          <p className="break-words text-muted-foreground">你指定的答案来源：{item.expected.map(target => sourceTitle(target, detail.sourceTitles)).join("、") || "本站没有答案"}</p>
          <p>{finding.thresholdKnown ? "筛选后的来源" : "待筛选的候选来源"}：{!row.matches.length && "没有"}</p>
          {row.matches.length > 0 && <ul aria-label={`问题 ${row.index + 1} 的检索来源`} className="space-y-2">{row.matches.map(match => <li key={match.target} className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{sourceTitle(match.target, detail.sourceTitles)}</span>
            {onAdopt && (draft?.expected.includes(match.target)
              ? <span className="text-xs text-muted-foreground">{item.expected.includes(match.target) ? "已在预设来源中" : "已加入草稿"}</span>
              : <Button type="button" variant="outline" size="sm" disabled={disabled || !draft || draft.expected.length >= 3} onClick={() => onAdopt(row.index, match.target)} aria-label={`将${sourceTitle(match.target, detail.sourceTitles)}加入问题 ${row.index + 1} 的可接受来源`}>核对后采纳此来源</Button>)}
          </li>)}</ul>}
          {onAdopt && !draft && <p className="text-xs text-muted-foreground">该题已在草稿中修改或移除，旧检索结果不能用于新问题。</p>}
          {onAdopt && draft && draft.expected.length >= 3 && <p className="text-xs text-muted-foreground">每题最多 3 个可接受来源；如需更换，请编辑问题草稿。</p>}
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">技术详情：相关性分数与来源标识</summary><p className="mt-2 break-all">{row.matches.map(match => `${match.target} (${match.score.toFixed(3)})`).join("、") || "无候选"}</p></details>
          {onEdit && <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(row.index)}>修改问题 {row.index + 1}</Button>}
          {detail.state === "complete" && detail.report && <KnowledgeAnswerPreview settingsRevision={settingsRevision} runId={detail.id} index={row.index} disabled={disabled} />}
        </li>;
      })}</ol>
      {pages > 1 && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页结果</Button><span>{currentPage}/{pages}</span><Button type="button" variant="outline" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>下一页结果</Button></div>}
    </details>
  </section>;
}
