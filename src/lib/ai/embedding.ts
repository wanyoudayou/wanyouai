import { AIError, object, list, type AIConnection } from "./connections";
import { embedMany } from "ai";
import type { AITransport } from "./transport";
import { embeddingModel, providerError } from "./sdk";

export const EMBEDDING_DIMENSIONS = 1024;
export function embeddingVectors(value: unknown, count: number, model: string): number[][] {
  const raw = object(value);
  if (raw.model !== model) throw new AIError("EMBEDDING_MODEL_MISMATCH");
  const items = list(raw.data);
  if (items.length !== count) throw new AIError("EMBEDDING_COUNT_MISMATCH");
  const vectors: number[][] = new Array(count);
  for (const item of items) {
    const row = object(item); const index = row.index; const vector = row.embedding;
    if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= count || vectors[Number(index)]) throw new AIError("EMBEDDING_INDEX_INVALID");
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) || !vector.some(value => value !== 0)) throw new AIError("EMBEDDING_VECTOR_INVALID");
    vectors[Number(index)] = vector;
  }
  return vectors;
}

export async function embed(connection: AIConnection, texts: string[], signal: AbortSignal, transport?: AITransport) {
  if (connection.purpose !== "embedding" || connection.protocol !== "embeddings" || !texts.length || texts.length > 16 || texts.some(text => !text.length || Buffer.byteLength(text) > 2048)) throw new AIError("INVALID_EMBEDDING_INPUT");
  try {
    const result = await embedMany({ model: embeddingModel(connection, signal, transport), values: texts, maxRetries: 0, maxParallelCalls: 1, abortSignal: signal, telemetry: { isEnabled: false } });
    if (result.responses?.length !== 1) throw new AIError("EMBEDDING_COUNT_MISMATCH");
    return embeddingVectors(result.responses[0]?.body, texts.length, connection.model);
  } catch (error) { throw providerError(error, signal); }
}
