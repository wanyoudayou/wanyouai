import test from "node:test";
import assert from "node:assert/strict";
import { evaluateKnowledge, evaluationCases, type EvaluationCase, type EvaluationMatch } from "../src/lib/ai/knowledge-evaluation";

const cases: EvaluationCase[] = Array.from({ length: 40 }, (_, index) => ({ question: `不同问题 ${index}`, expected: index % 2 ? [] : ["article:known-source"], split: index < 20 ? "train" : "holdout" }));
const matches = (): EvaluationMatch[][] => cases.map(item => [{ target: item.expected.length ? "article:known-source" : "article:other", score: item.expected.length ? 0.9 : 0.2 }]);
const digest = "a".repeat(64);
test("Evaluation auto-partitions balanced, nonduplicated questions", () => {
  assert.equal(evaluationCases(cases).length, 40);
  assert.equal(evaluationCases(cases.slice(0, 1)).length, 1);
  assert.equal(evaluationCases(cases.map(item => ({ ...item, split: "train" }))).filter(item => item.split === "holdout").length, 20);
  assert.throws(() => evaluationCases(cases.map((item, i) => i === 39 ? { ...item, question: cases[0].question } : item)), /CASE_INVALID/);
  assert.throws(() => evaluationCases(cases.map((item, i) => i === 39 ? { ...item, expected: ["https://untrusted.test"] } : item)), /CASE_INVALID/);
});
test("Diagnostic scores measure sources without changing a fixed cutoff", () => {
  const good = evaluateKnowledge(cases, matches(), digest); assert.equal(good.report.hits, 20); assert.equal(good.threshold, .5);
  const falsePositive = matches(); falsePositive[21][0].score = 0.99;
  const rejected = evaluateKnowledge(cases, falsePositive, digest);
  assert.equal(rejected.threshold, good.threshold); assert.equal(rejected.report.hits, 20); assert.equal(rejected.report.falsePositives, 1);
  const missed = matches(); missed[20][0].target = "article:wrong"; missed[22][0].score = 0.4;
  assert.equal(evaluateKnowledge(cases, missed, digest).report.recall, 0.9);
  const overlap = matches(); overlap[1][0].score = 0.95;
  assert.equal(evaluateKnowledge(cases, overlap, digest).report.falsePositives, 1);
});
test("Top-five source recall deduplicates repeated fragments but does not credit a missing source", () => {
  const result = matches();
  result[0] = [{ target: "article:known-source", score: 0.9 }, ...Array.from({ length: 10 }, () => ({ target: "article:known-source", score: 0.8 }))];
  assert.equal(evaluateKnowledge(cases, result, digest).report.hits, 20);
  result[0] = Array.from({ length: 6 }, (_, i) => ({ target: i === 5 ? "article:known-source" : `article:other-${i}`, score: 0.99 - i / 100 }));
  assert.equal(evaluateKnowledge(cases, result, digest).report.hits, 19);
});

test("Failure report identifies missing training sources and never labels unthresholded outside questions as false hits", async () => {
  const { evaluationFindings } = await import("../src/lib/ai/evaluation-result");
  const result = matches(); result[4] = [{ target: "article:wrong", score: .7 }];
  const detail = { id: "run", generationId: "generation", state: "complete", sourceRevision: 1, cases, results: result, report: null, issue: "KNOWLEDGE_TRAIN_RECALL_FAILED" };
  const finding = evaluationFindings(detail);
  assert.deepEqual(finding.attention.map(row => row.index), [4]);
  assert.equal(finding.rows[1].label, "尚不能判断是否应拒答");
  assert.equal(finding.rows[1].problem, false);
  assert.equal(finding.thresholdKnown, false);
  const separated = matches(); separated[1][0].score = .95;
  const overlap = evaluationFindings({ ...detail, results: separated, issue: "KNOWLEDGE_TRAIN_SEPARATION_FAILED" });
  assert(overlap.attention.some(row => row.index === 1));
  const good = evaluateKnowledge(cases, matches(), digest);
  const thresholded = evaluationFindings({ ...detail, results: matches(), report: { ...good.report, threshold: good.threshold }, issue: null });
  assert.equal(thresholded.rows[1].label, "正确识别为没有答案");
  assert.equal(thresholded.attention.length, 0);
});
