import { AIError, type AIConnection } from "./connections";
import { generate } from "./generation";
import { embed } from "./embedding";
import type { AITransport } from "./transport";

const fixtures = [
  "订阅到期后，订阅权益停止；此前单独购买的文章仍可阅读。",
  "在素材库上传图片，然后在文章编辑器选择图片并插入正文。",
  "Deploy the application on Vercel and configure the production domain.",
  "会员过期了，之前单买的文章还能看吗？",
  "如何把上传的图片放进文章？",
  "Where do I deploy the website and set its domain?",
];
const cosine = (a: number[], b: number[]) => a.reduce((sum, n, i) => sum + n * b[i], 0) / Math.sqrt(a.reduce((sum, n) => sum + n * n, 0) * b.reduce((sum, n) => sum + n * n, 0));
export async function probeConnection(connection: AIConnection, signal: AbortSignal, transport?: AITransport) {
  const deadline = () => AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  if (connection.purpose === "generation") {
    const messages = [{ role: "system" as const, content: "This is a minimal connection check. Reply OK only." }, { role: "user" as const, content: "OK" }];
    const json = await generate(connection, messages, { signal: deadline(), maxTokens: 128, transport });
    const stream = await generate(connection, messages, { signal: deadline(), maxTokens: 128, transport, onToken() {} });
    return { summary: { version: 1, json: true, streaming: true }, usage: { prompt_tokens: json.usage.prompt_tokens + stream.usage.prompt_tokens, completion_tokens: json.usage.completion_tokens + stream.usage.completion_tokens } };
  }
  const vectors = await embed(connection, fixtures, deadline(), transport);
  const [repeated] = await embed(connection, [fixtures[0]], deadline(), transport);
  if (cosine(vectors[0], repeated) < 0.99) throw new AIError("EMBEDDING_REPEAT_INCONSISTENT");
  for (let i = 0; i < 3; i++) {
    const scores = vectors.slice(0, 3).map(vector => cosine(vector, vectors[i + 3]));
    if (scores.indexOf(Math.max(...scores)) !== i) throw new AIError("EMBEDDING_SEMANTIC_PROBE_FAILED");
  }
  return { summary: { version: 1, dimensions: 1024, multilingual: true, repeated: true }, usage: { prompt_tokens: 0, completion_tokens: 0 } };
}
