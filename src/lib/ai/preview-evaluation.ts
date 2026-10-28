import { AIError } from "./connections";
import type { EvaluationCase, EvaluationMatch } from "./evaluation-cases";
import { rankedMatches } from "./evaluation-result";

export const PREVIEW_POLICY = 3;
const LEGACY_MINIMUM_RECALL = .8;

/** Read-only reproduction of historical reports. Never used to set runtime policy. */
export function evaluateLegacyPreview(cases: EvaluationCase[], results: EvaluationMatch[][], digest: string, fixedThreshold?: number | null) {
  if (results.length !== cases.length || !/^[a-f0-9]{64}$/.test(digest) || results.some(rows => !Array.isArray(rows) || rows.some(row => !Number.isFinite(row.score) || row.score < -1 || row.score > 1))) throw new AIError("KNOWLEDGE_EVALUATION_INCOMPLETE");
  function count(threshold: number, split?: EvaluationCase["split"]) {
    let positiveCases = 0, negativeCases = 0, hits = 0, falsePositives = 0;
    cases.forEach((item, index) => {
      if (split && item.split !== split) return;
      const matches = rankedMatches(results[index], threshold);
      if (item.expected.length) { positiveCases++; if (matches.some(match => item.expected.includes(match.target))) hits++; }
      else { negativeCases++; if (matches.length) falsePositives++; }
    });
    return { positiveCases, negativeCases, hits, falsePositives, recall: positiveCases ? hits / positiveCases : 0 };
  }
  let threshold: number;
  if (fixedThreshold !== undefined && fixedThreshold !== null) {
    if (!Number.isFinite(fixedThreshold) || fixedThreshold < -1 || fixedThreshold > 1) throw new AIError("KNOWLEDGE_EVALUATION_INCOMPLETE");
    threshold = fixedThreshold;
  } else {
    const scores = [...new Set([-1, 1, ...results.flatMap((rows, i) => cases[i].split === "train" ? rankedMatches(rows).map(row => row.score) : [])])].sort((a, b) => a - b);
    const choices = [...scores, ...scores.slice(1).map((value, i) => (value + scores[i]) / 2)].map(value => ({ threshold: value, ...count(value, "train") }));
    const viable = choices.filter(item => item.recall >= LEGACY_MINIMUM_RECALL);
    threshold = (viable.length ? viable.sort((a, b) => a.falsePositives - b.falsePositives || b.recall - a.recall || b.threshold - a.threshold)
      : choices.sort((a, b) => b.recall - a.recall || a.falsePositives - b.falsePositives || b.threshold - a.threshold))[0].threshold;
  }
  const all = count(threshold); const holdout = count(threshold, "holdout");
  return { threshold, report: {
    policyVersion: 2, passed: all.recall >= LEGACY_MINIMUM_RECALL,
    positiveCases: all.positiveCases, negativeCases: all.negativeCases, hits: all.hits,
    recall: all.recall, falsePositives: all.falsePositives,
    holdoutRecall: holdout.recall, holdoutFalsePositives: holdout.falsePositives,
    recommended: all.recall >= .9 && all.falsePositives === 0, regression: fixedThreshold != null, digest,
  } };
}

/** A diagnostic snapshot. Changing its labels cannot change vectors or runtime policy. */
export function evaluatePreview(cases: EvaluationCase[], results: EvaluationMatch[][], digest: string, fixedThreshold = .5) {
  if (results.length !== cases.length || !/^[a-f0-9]{64}$/.test(digest) || !Number.isFinite(fixedThreshold) || fixedThreshold < -1 || fixedThreshold > 1 ||
    results.some(rows => !Array.isArray(rows) || rows.some(row => !Number.isFinite(row.score) || row.score < -1 || row.score > 1))) throw new AIError("KNOWLEDGE_EVALUATION_INCOMPLETE");
  let positiveCases = 0, negativeCases = 0, hits = 0, falsePositives = 0;
  cases.forEach((item, index) => {
    const matches = rankedMatches(results[index], fixedThreshold);
    if (item.expected.length) { positiveCases++; if (matches.some(match => item.expected.includes(match.target))) hits++; }
    else { negativeCases++; if (matches.length) falsePositives++; }
  });
  return { threshold: fixedThreshold, report: { policyVersion: PREVIEW_POLICY, positiveCases, negativeCases, hits, falsePositives,
    recall: positiveCases ? hits / positiveCases : 0, digest } };
}
