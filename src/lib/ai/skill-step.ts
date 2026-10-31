import { generateText, jsonSchema, tool, type ModelMessage } from "ai";
import { AIError, list, object, tokenCount, type AIConnection } from "./connections";
import { generationSettings, validateTextMessages, type AIMessage, type GenerationResult } from "./generation";
import { providerError } from "./sdk";
import type { AITransport } from "./transport";

const TOOL = "read_skill_files";
export type SkillRead = { id: string; paths: string[] };
export type SkillExchange = SkillRead & { files: { path: string; content: string }[] };
export type SkillStepResult = GenerationResult & { read?: SkillRead };
const readTool = tool({
  description: "读取当前 Skill 版本清单中的文本文件。一次合并所需路径；不读取 URL、脚本或其他包。",
  inputSchema: jsonSchema<{ paths: string[] }>({ type: "object", additionalProperties: false, required: ["paths"], properties: {
    paths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 512 } },
  } }),
  // No execute callback: only the authorized host may read package contents.
});

export function skillStepMessages(messages: AIMessage[], exchanges: SkillExchange[]): ModelMessage[] {
  validateTextMessages(messages);
  return [...messages, ...exchanges.flatMap((exchange): ModelMessage[] => [
    { role: "assistant", content: [{ type: "tool-call", toolCallId: exchange.id, toolName: TOOL, input: { paths: exchange.paths } }] },
    { role: "tool", content: [{ type: "tool-result", toolCallId: exchange.id, toolName: TOOL, output: { type: "json", value: { files: exchange.files } } }] },
  ])];
}

/** Only this adapter accepts the one fixed client tool; no SDK tool execution or loop. */
export async function generateSkillStep(connection: AIConnection, messages: AIMessage[], options: {
  signal: AbortSignal; maxTokens: number; exchanges: SkillExchange[]; allowRead: boolean; transport?: AITransport;
}): Promise<SkillStepResult> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  try {
    const result = await generateText({
      ...generationSettings(connection, skillStepMessages(messages, options.exchanges), { ...options, signal }),
      tools: { [TOOL]: readTool }, toolChoice: options.allowRead ? "auto" : "none",
      include: { responseBody: true },
    });
    const raw = object(result.response.body);
    if (connection.protocol === "responses") {
      if (raw.status !== "completed" || raw.error || raw.incomplete_details) throw new AIError("GENERATION_INCOMPLETE");
      if (list(raw.output).some(item => !["message", "reasoning", "function_call"].includes(String(object(item).type)))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
    } else if (connection.protocol === "chat") {
      if (object(object(list(raw.choices)[0]).message).function_call) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
    } else if (list(raw.content).some(item => !["text", "thinking", "redacted_thinking", "tool_use"].includes(String(object(item).type)))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
    const counts = { prompt_tokens: tokenCount(result.usage.inputTokens), completion_tokens: tokenCount(result.usage.outputTokens) };
    if (result.toolCalls.length) {
      const call = result.toolCalls[0]; const input = object(call.input);
      if (!options.allowRead || result.toolCalls.length !== 1 || call.toolName !== TOOL || call.invalid ||
        !["stop", "tool-calls"].includes(result.finishReason) || !/^[\x21-\x7e]{1,256}$/.test(call.toolCallId) ||
        Object.keys(input).length !== 1 || !Array.isArray(input.paths) || !input.paths.length || input.paths.length > 6 ||
        !input.paths.every(p => typeof p === "string" && p.length > 0 && p.length <= 512)) throw new AIError("INVALID_SKILL_TOOL_CALL");
      if (result.content.some(part => !["text", "reasoning", "tool-call"].includes(part.type))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
      return { content: "", read: { id: call.toolCallId, paths: input.paths }, usage: counts };
    }
    if (result.content.some(part => !["text", "reasoning"].includes(part.type))) throw new AIError("UNSUPPORTED_GENERATION_OUTPUT");
    if (result.finishReason !== "stop") throw new AIError("GENERATION_INCOMPLETE");
    if (!result.text.trim() || Buffer.byteLength(result.text) > 131072) throw new AIError("INVALID_GENERATION_TEXT");
    return { content: result.text, usage: counts };
  } catch (error) { throw providerError(error, options.signal); }
  finally { controller.abort(); }
}
