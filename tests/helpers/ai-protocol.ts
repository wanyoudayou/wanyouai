// Synthetic provider payloads; never sent to a real model.
export const fixtures = {
  chat: { choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "你好" } }], usage: { prompt_tokens: 7, completion_tokens: 2 } },
  responses: { id: "response-test", status: "completed", output: [{ id: "message-test", type: "message", role: "assistant", content: [{ type: "output_text", text: "你好", annotations: [] }] }], usage: { input_tokens: 7, output_tokens: 2 } },
  messages: { type: "message", stop_reason: "end_turn", content: [{ type: "text", text: "你好" }], usage: { input_tokens: 7, output_tokens: 2 } },
};
export const events = {
  chat: [JSON.stringify({ choices: [{ index: 0, delta: { content: "你好" } }] }), JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 2 } }), "[DONE]"],
  responses: [JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "message-test" } }), JSON.stringify({ type: "response.output_text.delta", item_id: "message-test", output_index: 0, delta: "你好" }), JSON.stringify({ type: "response.output_item.done", output_index: 0, item: fixtures.responses.output[0] }), JSON.stringify({ type: "response.completed", response: fixtures.responses })],
  messages: [JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 7 } } }), JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "你好" } }), JSON.stringify({ type: "content_block_stop", index: 0 }), JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }), JSON.stringify({ type: "message_stop" })],
};
