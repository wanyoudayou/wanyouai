import type { createSupabaseServiceClient } from "../supabase/service";
import { AIError, object } from "./connections";
import { embed } from "./embedding";
import { knowledgeRPC } from "./knowledge";
import { loadAIConnection } from "./settings";
import type { KnowledgeEvaluationDetail } from "./knowledge-workflow";
import { rankedMatches as ranked } from "./evaluation-result";
import { evaluatePreview, evaluateLegacyPreview } from "./preview-evaluation";

import { evaluationCases, type EvaluationCase, type EvaluationMatch } from "./evaluation-cases";
export { evaluationCases } from "./evaluation-cases";
export type { EvaluationCase, EvaluationMatch } from "./evaluation-cases";
type Service = ReturnType<typeof createSupabaseServiceClient>;

export { evaluatePreview as evaluateKnowledge } from "./preview-evaluation";

export async function runEvaluationStep(service: Service, runId: string, signal: AbortSignal) {
  const lease = crypto.randomUUID();
  const claim = object(await knowledgeRPC(service, "claim_knowledge_evaluation", { p_run: runId, p_lease: lease }));
  if (claim.state !== "leased" || !Array.isArray(claim.cases)) {
    if (claim.state === "failed") throw new AIError("KNOWLEDGE_MANUAL_RETRY_REQUIRED");
    return;
  }
  const { data: generation, error } = await service.from("knowledge_index_generations").select("connection_id").eq("id", claim.generationId).single();
  if (error || !generation) throw new AIError("KNOWLEDGE_GENERATION_UNAVAILABLE");
  try {
    const connection = await loadAIConnection(service, generation.connection_id);
    if (!connection.verifiedAt) throw new AIError("KNOWLEDGE_CONNECTION_UNVERIFIED");
    const vectors = await embed(connection, claim.cases.map(value => String(object(value).question)), AbortSignal.any([signal, AbortSignal.timeout(15000)]));
    const results: EvaluationMatch[][] = [];
    for (const vector of vectors) {
      const rows = await knowledgeRPC(service, "match_knowledge", { p_generation: claim.generationId, p_embedding: JSON.stringify(vector), p_threshold: -1, p_limit: 24 });
      if (!Array.isArray(rows)) throw new AIError("KNOWLEDGE_SEARCH_UNAVAILABLE");
      results.push(rows.map(row => ({ target: row.target, score: row.score })));
    }
    if (await knowledgeRPC(service, "finish_knowledge_evaluation", { p_run: runId, p_lease: lease, p_results: results }) !== true) throw new AIError("KNOWLEDGE_WRITE_UNCONFIRMED");
  } catch (error) {
    try { await knowledgeRPC(service, "finish_knowledge_evaluation", { p_run: runId, p_lease: lease, p_results: [], p_failed: true }); } catch { /* unknown lease remains charged */ }
    throw error instanceof AIError ? error : new AIError("KNOWLEDGE_EVALUATION_INTERRUPTED");
  }
}

export async function finishEvaluation(service: Service, id: string) {
  const detail = await evaluationDetail(service, id);
  if (detail.state !== "complete" || !detail.report) throw new AIError("KNOWLEDGE_EVALUATION_INCOMPLETE");
  return { threshold: detail.report.threshold, report: detail.report };
}

/** Owner gateway only. Return questions and source references, never source bodies. */
export async function evaluationDetail(service: Service, id: string): Promise<KnowledgeEvaluationDetail> {
  const { data: run, error } = await service.from("knowledge_evaluations").select("id,generation_id,source_revision,digest,cases,results,state,fixed_threshold,policy_version").eq("id", id).single();
  if (error || !run) throw new AIError("KNOWLEDGE_EVALUATION_UNAVAILABLE");
  const cases = evaluationCases(run.cases);
  let report: KnowledgeEvaluationDetail["report"] = null; let issue: string | null = null;
  if (run.state === "complete") {
    try { const result = run.policy_version === 3 ? evaluatePreview(cases, run.results, run.digest, run.fixed_threshold ?? .5) : evaluateLegacyPreview(cases, run.results, run.digest, run.fixed_threshold); report = { ...result.report, threshold: result.threshold }; }
    catch (error) { issue = error instanceof AIError ? error.code : "KNOWLEDGE_EVALUATION_UNAVAILABLE"; }
  }
  const results = run.results.map((matches: EvaluationMatch[]) => ranked(matches)) as EvaluationMatch[][];
  const slugs = [...new Set([...cases.flatMap(item => item.expected), ...results.flatMap(matches => matches.map(item => item.target))])]
    .filter(target => /^article:[a-z0-9-]{1,120}$/.test(target)).map(target => target.slice(8));
  const sourceTitles: Record<string, string> = {};
  // Bounded metadata only. A missing title must not hide a saved evaluation result.
  for (let offset = 0; offset < slugs.length; offset += 80) {
    const { data, error } = await service.from("articles").select("slug,title").in("slug", slugs.slice(offset, offset + 80));
    if (error || !data) break;
    for (const article of data) sourceTitles[`article:${article.slug}`] = article.title;
  }
  return { id: run.id, generationId: run.generation_id, sourceRevision: run.source_revision, state: run.state, cases,
    results, report, issue, sourceTitles };
}

/** Reuse the accepted question set and runtime cutoff, never its old result. */
export async function knowledgeBaseline(service: Service, id: string) {
  const { data: candidate, error } = await service.from("knowledge_index_generations").select("mode,base_generation,connection_id,preprocessing").eq("id", id).single();
  if (error || !candidate) throw new AIError("KNOWLEDGE_GENERATION_UNAVAILABLE");
  if (candidate.mode !== "sync" || !candidate.base_generation) return null;
  const { data: base, error: failed } = await service.from("knowledge_index_generations").select("accepted_run,connection_id,preprocessing,accepted_policy_version,threshold").eq("id", candidate.base_generation).single();
  if (failed) throw new AIError("KNOWLEDGE_EVALUATION_UNAVAILABLE");
  if (!base?.accepted_run || base.connection_id !== candidate.connection_id || base.preprocessing !== candidate.preprocessing || ![2, 3].includes(base.accepted_policy_version)) return null;
  const { data: run, error: runMissing } = await service.from("knowledge_evaluations").select("cases,state").eq("id", base.accepted_run).single();
  if (runMissing || run?.state !== "complete") throw new AIError("KNOWLEDGE_EVALUATION_UNAVAILABLE");
  const cases = evaluationCases(run.cases);
  const targets = [...new Set(cases.flatMap(item => item.expected))];
  const missing = await knowledgeRPC(service, "knowledge_missing_sources", { p_targets: targets }) as string[];
  if (!Array.isArray(missing)) throw new AIError("KNOWLEDGE_EVALUATION_UNAVAILABLE");
  return { cases: cases.map(item => item.expected.some(target => missing.includes(target)) ? { ...item, reviewed: false } : item), threshold: base.threshold, missing: missing.length };
}

export async function validateEvaluationSources(service: Service, cases: EvaluationCase[]) {
  const expected = [...new Set(cases.flatMap(item => item.expected))];
  const valid = await knowledgeRPC(service, "knowledge_evaluation_sources_valid", { p_targets: expected });
  if (valid !== true) throw new AIError("KNOWLEDGE_EVALUATION_SOURCE_MISSING");
}
