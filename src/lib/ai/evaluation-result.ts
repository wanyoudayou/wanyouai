import type { EvaluationMatch } from "./evaluation-cases";
import type { KnowledgeEvaluationDetail } from "./knowledge-workflow";

/** Diagnostic reports use five distinct sources; they do not authorize activation. */
export function rankedMatches(matches: EvaluationMatch[], threshold = -1) {
  const targets = new Set<string>();
  return matches.filter(item => Number.isFinite(item.score) && item.score >= threshold)
    .sort((a, b) => b.score - a.score || a.target.localeCompare(b.target))
    .filter(item => targets.has(item.target) ? false : (targets.add(item.target), true)).slice(0, 5);
}

export function evaluationFindings(detail: KnowledgeEvaluationDetail) {
  const threshold = detail.report?.threshold;
  const rows = detail.cases.map((item, index) => {
    const complete = index < detail.results.length;
    const matches = rankedMatches(detail.results[index] ?? [], threshold ?? -1);
    const found = matches.some(match => item.expected.includes(match.target));
    const problem = complete && (item.expected.length ? !found : threshold !== undefined && matches.length > 0);
    return { index, matches, problem, label: !complete ? "尚未检查" : item.expected.length
      ? found ? "找到预期来源" : "未找到预期来源"
      : threshold === undefined ? "尚不能判断是否应拒答" : matches.length ? "库外问题被误命中" : "正确识别为没有答案" };
  });
  let attention = rows.filter(row => row.problem && (detail.issue === "KNOWLEDGE_TRAIN_RECALL_FAILED" ? detail.cases[row.index].split === "train" : true));
  if (detail.issue === "KNOWLEDGE_TRAIN_SEPARATION_FAILED") {
    const positives = detail.cases.flatMap((item, index) => item.split === "train" && item.expected.length
      ? [{ index, score: rankedMatches(detail.results[index] ?? []).find(match => item.expected.includes(match.target))?.score ?? -1 }] : []);
    const floor = Math.min(...positives.map(item => item.score));
    const conflicts = new Set(positives.filter(item => item.score === floor).map(item => item.index));
    detail.cases.forEach((item, index) => {
      if (item.split === "train" && !item.expected.length && (rankedMatches(detail.results[index] ?? [])[0]?.score ?? -1) >= floor) conflicts.add(index);
    });
    attention = rows.filter(row => conflicts.has(row.index));
  }
  return { rows, attention, thresholdKnown: threshold !== undefined };
}

export function sourceTitle(target: string, titles: Record<string, string> = {}) {
  return titles[target] || (target.startsWith("article:") ? `文章：${target.slice(8)}` : `公开问答 #${target.slice(3)}`);
}
