import { generateText, streamText, stepCountIs, type LanguageModelUsage, type ModelMessage } from "ai";
import { AIError, list, object, tokenCount, type AIConnection } from "./connections";
import type { AITransport } from "./transport";
import { generationModel, providerError } from "./sdk";

export type AIMessage = { role: "system" | "user" | "assistant"; content: string };
export type GenerationResult = { content: string; usage: { prompt_tokens: number; completion_tokens: number } };
const usage = (value: LanguageModelUsage): GenerationResult["usage"] => ({ prompt_tokens: tokenCount(value.inputTokens), completion_tokens: tokenCount(value.outputTokens) });
export function validateTextMessages(messages: AIMessage[]) {
  if (!messages.length || messages.some(item => !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string")) throw new AIError("INVALID_GENERATION_INPUT");
}

/** Shared provider policy; callers independently constrain output and tool authority. */
export function generationSettings(connection: AIConnection, messages: ModelMessage[], options: {
  signal: AbortSignal; maxTokens: number; transport?: AITransport;
}) {
  if (connection.purpose !== "generation") throw new AIError("INVALID_CONNECTION_PURPOSE");
  let providerOptions: Parameters<typeof generateText>[0]["providerOptions"];
  if (connection.protocol === "responses") providerOptions = { openai: { store: false } };
  else if (connection.protocol === "chat" && connection.baseUrl === "https://api.openai.com/v1") providerOptions = { openai: { systemMessageMode: "system" } };
  return {
    model: generationModel(connection, options.signal, options.transport),
    messages: connection.protocol === "chat" ? messages : messages.filter(item => item.role !== "system"),
    ...(connection.protocol !== "chat" ? { system: messages.filter(item => item.role === "system").map(item => item.content).join("\n\n") } : {}),
    allowSystemInMessages: true,
    maxOutputTokens: options.maxTokens, maxRetries: 0, abortSignal: options.signal,
    stopWhen: stepCountIs(1), telemetry: { isEnabled: false },
    providerOptions,
  };
}
function completed(reason: string, content: string) {
  if (reason !== "stop") throw new AIError("GENERATION_INCOMPLETE");
  if (!content.trim() || Buffer.byteLength(content) > 131_072) throw new AIError("INVALID_GENERATION_TEXT");
}

/** Project output policy, after the SDK has decoded the provider protocol. */
function envelope(protocol: AIConnection["protocol"], value: unknown) {
  const raw = object(value);
  if (protocol === "responses") {
    if (raw.status !== "completed" || raw.error || raw.incomplete_details) throw new AIError("GENERATION_INCOMPLETE");
    if (list(raw.output).some(item => !["message", "reasoning"].includes(String(object(item).type)))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
  } else if (protocol === "chat") {
    const message = object(object(list(raw.choices)[0]).message);
    if (message.function_call || list(message.tool_calls).length) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
  } else if (list(raw.content).some(item => !["text", "thinking", "redacted_thinking"].includes(String(object(item).type)))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
}

export async function generate(connection: AIConnection, messages: AIMessage[], options: {
  signal: AbortSignal; maxTokens: number; onToken?: (delta: string) => void; transport?: AITransport;
}): Promise<GenerationResult> {
  if (connection.purpose !== "generation") throw new AIError("INVALID_CONNECTION_PURPOSE");
  validateTextMessages(messages);
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  try {
    const settings = generationSettings(connection, messages, { ...options, signal });
    if (!options.onToken) {
      const result = await generateText({ ...settings, include: { responseBody: true } });
      envelope(connection.protocol, result.response.body);
      completed(result.finishReason, result.text);
      if (result.content.some(part => !["text", "reasoning"].includes(part.type))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
      return { content: result.text, usage: usage(result.usage) };
    }
    const result = streamText({ ...settings, includeRawChunks: true, onError() {} });
    let content = ""; let finished = false; let counts: GenerationResult["usage"] | undefined;
    let terminal = connection.protocol === "chat";
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type === "abort") throw new AIError("PROVIDER_CANCELLED");
      if (part.type.startsWith("tool-") || ["file", "source"].includes(part.type) || (part.type === "custom" && part.kind !== "anthropic.message_start")) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
      if (part.type === "raw") {
        const raw = object(part.rawValue);
        const delta = object(object(list(raw.choices)[0]).delta);
        if (delta.function_call || delta.tool_calls) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
        if (raw.type === "response.output_item.added" && !["message", "reasoning"].includes(String(object(raw.item).type))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
        if (raw.type === "content_block_start" && !["text", "thinking", "redacted_thinking"].includes(String(object(raw.content_block).type))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
        if (raw.type === "response.completed") {
          envelope("responses", raw.response);
          const finalText = list(object(raw.response).output).flatMap(item => list(object(item).content).filter(part => object(part).type === "output_text").map(part => object(part).text)).join("");
          if (finalText !== content) throw new AIError("GENERATION_TEXT_MISMATCH");
          terminal = true;
        }
        if (raw.type === "message_stop") terminal = true;
      }
      if (part.type === "text-delta") {
        content += part.text;
        if (Buffer.byteLength(content) > 131_072) throw new AIError("GENERATION_TEXT_TOO_LARGE");
        options.onToken(part.text);
      }
      if (part.type === "finish") { completed(part.finishReason, content); finished = true; counts = usage(part.totalUsage); }
    }
    signal.throwIfAborted();
    if (!finished || !terminal || !counts) throw new AIError("GENERATION_INCOMPLETE");
    return { content, usage: counts };
  } catch (error) { throw providerError(error, options.signal); }
  finally { controller.abort(); }
}
