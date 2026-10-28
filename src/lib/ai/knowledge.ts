import type { createSupabaseServiceClient } from "../supabase/service";
import { AIError, type AIConnection } from "./connections";
import { embed } from "./embedding";
import { loadAIConnection } from "./settings";

type Service = ReturnType<typeof createSupabaseServiceClient>;
export type KnowledgePart = { start: number; end: number; content: string };
export type KnowledgeGeneration = {
  id: string; connectionId: string; state: "building" | "ready" | "active" | "retired" | "failed";
  scanCursor: string; scanComplete: boolean; approvedRevision: number; providerAttempts: number;
  threshold: number | null; evaluatedRevision: number | null; evaluation: Record<string, unknown> | null;
  counts: { total: number; ready: number; pending: number; leased: number; failed: number; obsolete: number };
  mode?: "initialize" | "sync" | "rebuild"; baseGeneration?: string | null; reusedItems?: number;
  acceptedRun?: string | null;
};
export type KnowledgeStatus = {
  sourceRevision: number; selectedConnection: string | null; activeGeneration: string | null; sourceCount: number; sourceBytes: number;
  generationCount: number; generations: KnowledgeGeneration[];
  evaluations: { id: string; generationId: string; sourceRevision: number; state: "pending" | "leased" | "failed" | "complete"; completed: number; total: number; attempts: number }[];
};

/** PostgreSQL char offsets count Unicode code points, not UTF-16 units. No text is truncated. */
export function knowledgeParts(text: string): KnowledgePart[] {
  const chars = Array.from(text); const parts: KnowledgePart[] = []; let start = 0;
  while (start < chars.length) {
    let end = start; let bytes = 0; let boundary = -1;
    while (end < chars.length) {
      const size = Buffer.byteLength(chars[end]);
      if (bytes + size > 2048) break;
      bytes += size; end++;
      if (bytes >= 1024 && /[\n。！？.!?]/u.test(chars[end - 1])) boundary = end;
    }
    if (end < chars.length && boundary > start) end = boundary;
    if (end === start || parts.length >= 4096) throw new AIError("KNOWLEDGE_SOURCE_TOO_LARGE");
    parts.push({ start, end, content: chars.slice(start, end).join("") }); start = end;
  }
  if (!parts.length) throw new AIError("KNOWLEDGE_EMPTY_SOURCE");
  return parts;
}

export async function knowledgeStatus(service: Service): Promise<KnowledgeStatus> {
  const { data, error } = await service.rpc("knowledge_index_status");
  if (error || !data || !Array.isArray(data.generations) || !Number.isSafeInteger(data.sourceRevision)) throw new AIError("KNOWLEDGE_STATUS_UNAVAILABLE");
  if (!Array.isArray(data.evaluations)) throw new AIError("KNOWLEDGE_STATUS_UNAVAILABLE");
  // Evaluation records have no creation timestamp. The UI restores a known run
  // ID or asks which saved result to view; RPC array order is not chronology.
  return data as KnowledgeStatus;
}
export async function knowledgeRPC(service: Service, name: string, params: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, params);
  if (error) {
    const code = /^KNOWLEDGE_[A-Z_]+$/.test(error.message ?? "") ? error.message : "KNOWLEDGE_OPERATION_UNCONFIRMED";
    throw new AIError(code);
  }
  return data;
}

/** One bounded discovery step OR one provider batch. An uncertain batch is never replayed here. */
export async function runKnowledgeStep(service: Service, id: string, signal: AbortSignal,
  dependencies: { load?: typeof loadAIConnection; embed?: (connection: AIConnection, texts: string[], signal: AbortSignal) => Promise<number[][]> } = {}) {
  const status = await knowledgeStatus(service);
  const generation = status.generations.find(generation => generation.id === id);
  if (!generation || generation.state !== "building") throw new AIError("KNOWLEDGE_GENERATION_UNAVAILABLE");
  if (generation.approvedRevision !== status.sourceRevision) throw new AIError("KNOWLEDGE_SOURCE_CHANGED");
  if (generation.counts.failed) throw new AIError("KNOWLEDGE_MANUAL_RETRY_REQUIRED");
  if (!generation.scanComplete) {
    const { data: sources, error } = await service.from("knowledge_sources").select("source_key,source_hash,content").gt("source_key", generation.scanCursor).order("source_key").limit(4);
    if (error || !sources) throw new AIError("KNOWLEDGE_SOURCE_UNAVAILABLE");
    for (const source of sources) {
      if (await knowledgeRPC(service, "register_knowledge_source", { p_generation: id, p_source: source.source_key, p_hash: source.source_hash, p_parts: knowledgeParts(source.content) }) !== true) throw new AIError("KNOWLEDGE_SOURCE_CHANGED");
    }
    if (sources.length < 4) await knowledgeRPC(service, "complete_knowledge_scan", { p_generation: id });
    return { phase: "scan" as const, status: await knowledgeStatus(service) };
  }
  const connection = await (dependencies.load ?? loadAIConnection)(service, generation.connectionId);
  if (!connection.verifiedAt) throw new AIError("KNOWLEDGE_CONNECTION_UNVERIFIED");
  const lease = crypto.randomUUID();
  const items = await knowledgeRPC(service, "claim_knowledge_batch", { p_generation: id, p_lease: lease }) as { item_id: string; content: string }[];
  if (!Array.isArray(items)) throw new AIError("KNOWLEDGE_CLAIM_UNCONFIRMED");
  if (!items.length) return { phase: "waiting" as const, status: await knowledgeStatus(service) };
  try {
    const vectors = await (dependencies.embed ?? embed)(connection, items.map(item => item.content), AbortSignal.any([signal, AbortSignal.timeout(15000)]));
    if (vectors.length !== items.length) throw new AIError("EMBEDDING_COUNT_MISMATCH");
    const saved = await knowledgeRPC(service, "finish_knowledge_batch", { p_generation: id, p_lease: lease, p_vectors: items.map((item, index) => ({ id: item.item_id, vector: vectors[index] })) });
    if (saved !== true) throw new AIError("KNOWLEDGE_WRITE_UNCONFIRMED");
  } catch (error) {
    // A lost response can mean the provider already billed the request. Preserve this
    // uncertainty even when bookkeeping fails; lease expiry also requires manual retry.
    try { await knowledgeRPC(service, "finish_knowledge_batch", { p_generation: id, p_lease: lease, p_vectors: [], p_error: "PROVIDER_OUTCOME_UNCONFIRMED" }); } catch { /* lease remains visible */ }
    throw error instanceof AIError ? error : new AIError("KNOWLEDGE_BATCH_INTERRUPTED");
  }
  return { phase: "embedding" as const, status: await knowledgeStatus(service) };
}
