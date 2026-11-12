export async function readBoundedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("Body exceeds limit"); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks);
}

/** Parse a JSON object body without buffering more than `limit` bytes. */
export async function readBoundedJson(request: Request, limit = 16 * 1024): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse((await readBoundedBody(request, limit)).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
  return value as Record<string, unknown>;
}
