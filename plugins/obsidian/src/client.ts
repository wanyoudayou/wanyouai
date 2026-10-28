import { request } from "node:https";
import { isHandbookDraftWrite, siteOrigin, type ConnectionInfo } from "../../../packages/handbook-protocol/src";
export class HandbookRequestError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }
export class HandbookNetworkError extends Error {
  constructor(readonly code: string, readonly action: string, uncertain = true, elapsedMs?: number) {
    const reason = ({ ETIMEDOUT: "连接或响应超时", ECONNRESET: "连接被中断", ENOTFOUND: "域名解析失败", EAI_AGAIN: "域名解析暂时不可用", ECONNREFUSED: "连接被拒绝", CERT_HAS_EXPIRED: "站点证书已过期", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "无法验证站点证书" } as Record<string, string>)[code] ?? "网络连接未完成";
    const next = !uncertain ? "请恢复连接后重新读取；本次读取不会修改线上文稿。" : action === "创建线上手册" ? "请恢复连接后在当前窗口重试；插件先查询原创建任务，不另建一份。" : action.includes("图片") ? "请恢复连接后重新比对并确认，将沿用原图片任务继续。" : "结果需查询原任务确认；请点击“查询未确认任务”，不会重新提交文稿。";
    super(`${action}：${reason}（${code}）${elapsedMs === undefined ? "" : `，耗时 ${(elapsedMs / 1000).toFixed(1)} 秒`}。${next}`);
  }
}
const actionNames: Record<string, string> = { connect: "连接站点", list: "读取手册列表", inventory: "读取线上版本", status: "查询原任务状态", compare: "比对文稿", stage: "保存草稿", publish: "发布文稿", activate: "公开手册", rename: "绑定改名文件", create: "创建线上手册", "media-prepare": "准备上传图片", "media-finish": "确认图片上传" };
function networkError(error: unknown, action: string, uncertain: boolean, elapsedMs: number) {
  const raw = error && typeof error === "object" && "code" in error ? error.code : "NETWORK_ERROR";
  const code = typeof raw === "string" && /^[A-Z_0-9]{1,60}$/.test(raw) ? raw : "NETWORK_ERROR";
  return new HandbookNetworkError(code, action, uncertain, elapsedMs);
}
/** Desktop Node transport: does not follow redirects, use browser cookies, or log request data. */
function httpsRequest(url: URL, method: string, headers: Record<string, string>, body: Uint8Array | undefined, action: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = request(url, { method, headers, agent: false, timeout: 65000 }, response => {
      const status = response.statusCode ?? 500;
      if (status >= 300 && status < 400) { response.destroy(); reject(new Error("站点发生重定向，已停止发送凭据；请确认固定域名后重新连接。")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { response.destroy(); reject(new Error("响应过大，已停止。")); } else chunks.push(chunk); });
      response.on("error", error => reject(networkError(error, action, method !== "GET" && action !== "比对文稿", Date.now() - started)));
      response.on("end", () => {
        let data: unknown; try { data = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { reject(new HandbookRequestError(`${action}：站点未返回有效数据（HTTP ${status}）。请查询原任务状态。`, status)); return; }
        if (status === 409 && method === "PUT") { resolve(data); return; }
        if (status < 200 || status >= 300) { const message = data && typeof data === "object" && "message" in data && typeof data.message === "string" ? data.message : "请求失败，请检查连接和发布权限。"; reject(new HandbookRequestError(`${action}（HTTP ${status}）：${message}`, status, data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : undefined)); return; }
        resolve(data);
      });
    });
    // An idle socket timeout alone would let a trickling response run forever.
    const timeout = () => Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const deadline = setTimeout(() => req.destroy(timeout()), 65000);
    req.once("close", () => clearTimeout(deadline));
    req.on("timeout", () => req.destroy(timeout()));
    req.on("error", error => reject(networkError(error, action, method !== "GET" && action !== "比对文稿", Date.now() - started)));
    if (body) req.write(body); req.end();
  });
}
export class HandbookClient {
  readonly origin: string;
  constructor(origin: string, private credential: string, credentialOrigin: string) { this.origin = siteOrigin(origin); if (siteOrigin(credentialOrigin) !== this.origin) throw new Error("站点已变更，请重新选择该站的手册上传凭据。"); if (!/^whp_[a-f0-9]{64}$/.test(credential)) throw new Error("请选择本站生成的手册上传凭据。"); }
  async get<T>(action: "connect" | "list" | "inventory" | "status", query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`/api/handbooks/v1/${action}`, this.origin); url.search = new URLSearchParams(query).toString();
    return await httpsRequest(url, "GET", { Authorization: `Bearer ${this.credential}` }, undefined, actionNames[action]) as T;
  }
  async post<T>(action: string, value: object): Promise<T> {
    if (!isHandbookDraftWrite(action)) throw new Error("插件仅支持草稿上传；发布请到网页后台完成。");
    const body = Buffer.from(JSON.stringify(value)); if (body.length > 2 * 1024 * 1024) throw new Error("文章或请求超过 2 MiB，请拆分内容。");
    return await httpsRequest(new URL(`/api/handbooks/v1/${action}`, this.origin), "POST", { Authorization: `Bearer ${this.credential}`, "Content-Type": "application/json", "Content-Length": String(body.length) }, body, actionNames[action]) as T;
  }
  async upload(url: string, bytes: Uint8Array, mime: string, connection: ConnectionInfo) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.origin !== connection.uploadOrigin || !parsed.pathname.startsWith("/storage/v1/object/upload/sign/media-uploads/") || parsed.username || parsed.password) throw new Error("图片上传地址与已连接站点不一致。");
    // Only the public Supabase key goes to Storage, never the handbook credential.
    await httpsRequest(parsed, "PUT", { apikey: connection.publicKey, "Content-Type": mime, "Content-Length": String(bytes.byteLength) }, bytes, "上传图片");
  }
}
