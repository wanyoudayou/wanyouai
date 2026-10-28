import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import { Readable, Transform } from "node:stream";
import { AIError, connectionDefinition, validAPIKey, type AIConnection } from "./connections";
import { withinSignal } from "../avatar/deadline";

const privateIPv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateIPv4.addSubnet(address, prefix, "ipv4");
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
const reservedIPv6 = new BlockList();
for (const [address, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const)
  reservedIPv6.addSubnet(address, prefix, "ipv6");

export function publicAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !privateIPv4.check(address, "ipv4") : family === 6 && globalIPv6.check(address, "ipv6") && !reservedIPv6.check(address, "ipv6");
}

export type AITransport = (connection: AIConnection, path: string, body: unknown, options: { signal: AbortSignal; maxBytes?: number }) => Promise<Response>;

/** DNS is validated before credentials are sent; the socket uses that same address. */
type OpenRequest = (url: URL, options: RequestOptions, listener: (response: IncomingMessage) => void) => ClientRequest;
export function createProviderTransport(deps: {
  resolve?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  open?: OpenRequest;
} = {}): AITransport {
 return async (connection, path, body, { signal, maxBytes = 1_048_576 }) => {
  connectionDefinition(connection);
  if (!validAPIKey(connection.apiKey)) throw new AIError("INVALID_CREDENTIAL");
  const allowedPath = connection.protocol === "chat" ? "/chat/completions" : connection.protocol === "responses" ? "/responses" : connection.protocol === "messages" ? "/messages" : "/embeddings";
  if (path !== allowedPath) throw new AIError("INVALID_PROVIDER_PATH");
  const url = new URL(connection.baseUrl + path);
  const addresses = await withinSignal((deps.resolve ?? (host => lookup(host, { all: true, verbatim: true })))(url.hostname), signal).catch(() => { throw new AIError("DNS_UNAVAILABLE"); });
  if (!addresses.length || addresses.some(item => !publicAddress(item.address))) throw new AIError("UNSAFE_PROVIDER_ADDRESS");
  const pinned = addresses.find(item => item.family === 4) ?? addresses[0];
  signal.throwIfAborted();
  const payload = JSON.stringify(body);
  if (Buffer.byteLength(payload) > 131_072) throw new AIError("PROVIDER_INPUT_TOO_LARGE");
  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": String(Buffer.byteLength(payload)), "accept-encoding": "identity" };
    if (connection.protocol === "messages") {
      headers["x-api-key"] = connection.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else headers.authorization = `Bearer ${connection.apiKey}`;
    const req = (deps.open ?? request)(url, {
      method: "POST", headers, signal, agent: false, family: pinned.family,
      lookup: (_hostname, options, callback) => options.all
        ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
    }, response => {
      const status = response.statusCode ?? 502;
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new AIError(status >= 300 && status < 400 ? "PROVIDER_REDIRECT_DENIED" : "PROVIDER_HTTP_ERROR", status));
        return;
      }
      if (Number(response.headers["content-length"] ?? 0) > maxBytes ||
        (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy(); reject(new AIError("PROVIDER_RESPONSE_TOO_LARGE")); return;
      }
      let bytes = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        done(bytes > maxBytes ? new AIError("PROVIDER_RESPONSE_TOO_LARGE") : null, chunk);
      } });
      response.on("error", () => meter.destroy(new AIError("PROVIDER_INTERRUPTED")));
      const stream = response.pipe(meter);
      stream.on("close", () => response.destroy());
      resolve(new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers: { "content-type": String(response.headers["content-type"] ?? "application/json") } }));
    });
    req.on("error", () => reject(new AIError(signal.aborted ? "PROVIDER_CANCELLED" : "PROVIDER_UNAVAILABLE")));
    req.end(payload);
  });
 };
}
export const providerRequest = createProviderTransport();

/** Also bounds injected transports and non-streaming bodies. */
export async function providerJSON(response: Response, signal: AbortSignal, maxBytes = 1_048_576): Promise<unknown> {
  if (!response.ok) throw new AIError("PROVIDER_HTTP_ERROR", response.status);
  let body = "";
  for await (const chunk of providerBytes(response, signal, maxBytes)) body += chunk;
  try { return JSON.parse(body); } catch { throw new AIError("INVALID_PROVIDER_JSON"); }
}

export async function* providerBytes(response: Response, signal: AbortSignal, maxBytes = 1_048_576) {
  if (!response.body) throw new AIError("EMPTY_PROVIDER_RESPONSE");
  const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0;
  try {
    for (;;) {
      const result = await withinSignal(reader.read(), signal);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) throw new AIError("PROVIDER_RESPONSE_TOO_LARGE");
      yield decoder.decode(result.value, { stream: true });
    }
    yield decoder.decode();
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
