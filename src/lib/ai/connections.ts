export type GenerationProtocol = "chat" | "responses" | "messages";
export type ConnectionDefinition = {
  purpose: "generation" | "embedding";
  protocol: GenerationProtocol | "embeddings";
  baseUrl: string;
  model: string;
};
export type AIConnection = ConnectionDefinition & { id: string; apiKey: string; verifiedAt: string | null };

/** Reviewed targets only. Adding a proxy/provider requires a code and security review. */
export const AI_TARGETS = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com", protocols: ["chat", "responses"] },
  { name: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1", protocols: ["chat", "embeddings"] },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocols: ["chat", "responses"] },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocols: ["messages"] },
] as const;

export class AIError extends Error {
  constructor(public readonly code: string, public readonly httpStatus?: number) {
    super(code);
    this.name = "AIError";
  }
}

export function connectionDefinition(value: unknown): ConnectionDefinition {
  const raw = object(value);
  const purpose = raw.purpose;
  const protocol = raw.protocol;
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.replace(/\/$/, "") : "";
  const model = raw.model;
  const target = AI_TARGETS.find(target => target.baseUrl === baseUrl);
  if (!target || !target.protocols.some(item => item === protocol) ||
    !["generation", "embedding"].includes(String(purpose)) ||
    (purpose === "embedding") !== (protocol === "embeddings") ||
    typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model) ||
    (purpose === "embedding" && model !== "BAAI/bge-m3")) throw new AIError("INVALID_CONNECTION");
  return { purpose, protocol, baseUrl, model } as ConnectionDefinition;
}

export function validAPIKey(value: string) {
  return /^[\x21-\x7e]{10,1024}$/.test(value);
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const tokenCount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647 ? Number(value) : 0;
