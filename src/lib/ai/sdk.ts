import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { AIError, connectionDefinition, object, validAPIKey, type AIConnection } from "./connections";
import { providerBytes, providerJSON, providerRequest, type AITransport } from "./transport";
import { withinSignal } from "../avatar/deadline";

// The SDK's default warnings can contain provider data. Application errors use codes only.
globalThis.AI_SDK_LOG_WARNINGS = false;

/** One invocation has one credential-bound destination and at most one paid dispatch. */
export function providerFetch(connection: AIConnection, signal: AbortSignal, transport: AITransport = providerRequest): typeof fetch {
  connectionDefinition(connection);
  if (!validAPIKey(connection.apiKey)) throw new AIError("INVALID_CREDENTIAL");
  let dispatched = false;
  const path = connection.protocol === "chat" ? "/chat/completions" : connection.protocol === "responses" ? "/responses" : connection.protocol === "messages" ? "/messages" : "/embeddings";
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.method !== "POST" || request.url !== connection.baseUrl + path) throw new AIError("INVALID_PROVIDER_PATH");
    const deadline = AbortSignal.any([signal, request.signal]);
    deadline.throwIfAborted();
    const body = object(await providerJSON(new Response(request.body), deadline, 131_072).catch(error => {
      if (error instanceof AIError && error.code === "PROVIDER_RESPONSE_TOO_LARGE") throw new AIError("PROVIDER_INPUT_TOO_LARGE");
      throw error;
    }));
    if (body.model !== connection.model) throw new AIError("INVALID_CONNECTION");
    // Keep task policy independent of SDK defaults and provider model-name heuristics.
    if (connection.protocol === "responses") body.store = false;
    if (connection.baseUrl === "https://api.deepseek.com") {
      if (connection.protocol === "chat") body.thinking = { type: "disabled" };
      else body.reasoning = { effort: "none" };
    }
    if (dispatched) throw new AIError("PROVIDER_REPEAT_DISPATCH_DENIED");
    dispatched = true;
    const response = await withinSignal(transport(connection, path, body, { signal: deadline }), deadline);
    if (!response.ok) throw new AIError("PROVIDER_HTTP_ERROR", response.status);
    // Bound injected transports too. The transport establishes trusted auth/TLS;
    // no arbitrary SDK request headers are forwarded.
    const bytes = providerBytes(response, deadline);
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const item = await bytes.next();
          if (item.done) controller.close();
          else controller.enqueue(new TextEncoder().encode(item.value));
        } catch (error) { controller.error(error); }
      },
      async cancel() { await bytes.return(undefined); },
    }), { headers: { "content-type": response.headers.get("content-type") ?? "application/json" } });
  };
}

export function generationModel(connection: AIConnection, signal: AbortSignal, transport?: AITransport) {
  const fetch = providerFetch(connection, signal, transport);
  const options = { baseURL: connection.baseUrl, apiKey: connection.apiKey, fetch };
  if (connection.protocol === "messages") return createAnthropic(options)(connection.model);
  if (connection.protocol === "responses") return createOpenAI(options).responses(connection.model);
  if (connection.protocol === "chat" && connection.baseUrl === "https://api.openai.com/v1") return createOpenAI(options).chat(connection.model);
  if (connection.protocol === "chat") return createOpenAICompatible({ ...options, name: "wanyou", includeUsage: true }).chatModel(connection.model);
  throw new AIError("INVALID_GENERATION_PROTOCOL");
}

export function embeddingModel(connection: AIConnection, signal: AbortSignal, transport?: AITransport) {
  return createOpenAICompatible({ name: "wanyou", baseURL: connection.baseUrl, apiKey: connection.apiKey, fetch: providerFetch(connection, signal, transport) }).embeddingModel(connection.model);
}

/** SDK errors may include bodies, headers and prompts; never expose their messages. */
export function providerError(error: unknown, signal?: AbortSignal): AIError {
  if (signal?.aborted) return new AIError("PROVIDER_CANCELLED");
  let cause = error;
  for (let depth = 0; depth < 6 && cause; depth++) {
    if (cause instanceof AIError) return cause;
    if (["AI_NoOutputGeneratedError", "AI_NoContentGeneratedError"].includes(String(object(cause).name))) return new AIError("GENERATION_INCOMPLETE");
    cause = object(cause).cause;
  }
  return new AIError("INVALID_PROVIDER_RESPONSE");
}
