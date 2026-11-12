/** 浏览器端 JSON 请求的统一结果处理：非 JSON、缺少 message 与超时都给出中文提示。 */
export class RequestError extends Error {
  constructor(message: string, readonly status: number | null) { super(message); }
  /** 服务端明确拒绝（4xx）：请求已被处理，不存在“结果未知”。 */
  get rejected() { return this.status !== null && this.status >= 400 && this.status < 500; }
}

export async function readJson<T>(response: Response, fallback: string): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { message?: unknown }) | null;
  if (!response.ok || data === null) {
    const message = data && typeof data.message === "string" && data.message.trim() ? data.message : fallback;
    throw new RequestError(message, response.status);
  }
  return data;
}

export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof RequestError) return error.message;
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) return "请求超时，请稍后查询状态或重试。";
  return fallback;
}
