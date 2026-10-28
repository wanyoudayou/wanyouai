import type { KnowledgeGeneration, KnowledgeStatus } from "./knowledge";
import type { EvaluationCase } from "./evaluation-cases";

export type KnowledgeMode = "initialize" | "sync" | "rebuild";
export type KnowledgeSourceChoice = { target: string; title: string };
export type KnowledgeReport = { passed?: boolean; holdoutRecall?: number; holdoutFalsePositives?: number; threshold?: number;
  policyVersion?: number; positiveCases?: number; negativeCases?: number; hits?: number; recall?: number; falsePositives?: number; recommended?: boolean; regression?: boolean };
export type KnowledgeEvaluationDetail = {
  id: string; state: string; sourceRevision: number; generationId: string;
  cases: EvaluationCase[]; results: { target: string; score: number }[][];
  report: KnowledgeReport | null; issue: string | null;
  sourceTitles?: Record<string, string>;
};

export function indexComplete(status: KnowledgeStatus, generation: KnowledgeGeneration) {
  const n = generation.counts;
  return status.sourceCount > 0 && generation.approvedRevision === status.sourceRevision && generation.scanComplete &&
    n.total > 0 && n.ready === n.total && n.pending + n.leased + n.failed === 0;
}
export function currentCandidate(status: KnowledgeStatus) {
  return status.generations.find(item => item.state === "building" || item.state === "ready");
}
export function knowledgeStep(status: KnowledgeStatus, available: boolean): 1 | 2 | 3 | 4 | 5 {
  if (!available || status.sourceCount === 0) return 1;
  const candidate = currentCandidate(status);
  if (candidate) {
    if (!indexComplete(status, candidate)) return 3;
    return 4;
  }
  const active = status.generations.find(item => item.id === status.activeGeneration);
  return active && active.connectionId === status.selectedConnection && indexComplete(status, active) ? 5 : 2;
}
export function evaluationIssue(code: string) {
  const messages: Record<string, string> = {
    KNOWLEDGE_EVALUATION_CASES_REQUIRED: "准备 1–100 个问题即可检查；可以只检查你关心的问题。",
    KNOWLEDGE_EVALUATION_BALANCE_REQUIRED: "可以只检查你关心的问题，无需分组或凑题数。",
    KNOWLEDGE_ANSWERS_UNREVIEWED: "请先逐题确认答案来源或“本站没有答案”，尚未核对的问题不能开始预演。",
    KNOWLEDGE_EVALUATION_CASE_INVALID: "问题有空白、重复、过长或无效来源，请检查表单。",
    KNOWLEDGE_TRAIN_RECALL_FAILED: "部分问题没有找到你指定的文章，需要先核对这些问题与文章内容。",
    KNOWLEDGE_TRAIN_SEPARATION_FAILED: "系统还不能可靠地区分“本站有答案”和“本站没有答案”的问题。",
  };
  return messages[code] ?? "验收结果未确认，请刷新状态后查看已保存的结果。";
}
