import { AIError, object } from "./connections";

export type EvaluationCase = { question: string; expected: string[]; split: "train" | "holdout"; reviewed?: boolean; suggestedTarget?: string; suggestedTitle?: string; evidence?: string };
export type EvaluationMatch = { target: string; score: number };

export function evaluationCases(value: unknown): EvaluationCase[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new AIError("KNOWLEDGE_EVALUATION_CASES_REQUIRED");
  const seen = new Set<string>();
  const groups = [0, 0];
  const cases = value.map(value => {
    const raw = object(value); const question = typeof raw.question === "string" ? raw.question.trim() : "";
    const normalized = question.toLowerCase().replace(/\s+/g, " ");
    if (raw.reviewed === false) throw new AIError("KNOWLEDGE_ANSWERS_UNREVIEWED");
    if (!question || new TextEncoder().encode(question).length > 1024 || seen.has(normalized) || (raw.split !== undefined && !["train", "holdout"].includes(String(raw.split))) ||
      !Array.isArray(raw.expected) || raw.expected.length > 3 || raw.expected.some(target => typeof target !== "string" || !/^(article:[a-z0-9-]{1,120}|qa:[0-9]{1,20})$/.test(target))) throw new AIError("KNOWLEDGE_EVALUATION_CASE_INVALID");
    const partition = raw.expected.length ? 0 : 1;
    const split = groups[partition]++ % 2 ? "holdout" : "train";
    seen.add(normalized); return { question, expected: [...new Set(raw.expected)] as string[], split: split as EvaluationCase["split"] };
  });
  return cases;
}

