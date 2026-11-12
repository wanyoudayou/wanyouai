import { HandbookClient } from "./client";
import { HANDBOOK_PROTOCOL, siteOrigin, type ConnectionInfo } from "../../../packages/handbook-protocol/src";

export type ConnectionSettings = { origin: string; secretRef: string; secretOrigin: string };
type Connected = { key: string; client: HandbookClient; info: ConnectionInfo };
/** One silent handshake per saved site/credential, pinned before reading the token. */
export class HandbookConnection {
  private value: Connected | null = null;
  private pending: { key: string; promise: Promise<Connected> } | null = null;
  private generation = 0;
  constructor(private secret: (ref: string) => string | null, private makeClient = (s: ConnectionSettings, token: string) => new HandbookClient(s.origin, token, s.secretOrigin)) {}
  private key(s: ConnectionSettings) { return `${siteOrigin(s.origin)}\n${s.secretRef}\n${siteOrigin(s.secretOrigin)}`; }
  peek(s: ConnectionSettings) { try { return this.value?.key === this.key(s) ? this.value : null; } catch { return null; } }
  clear() { this.generation++; this.value = null; this.pending = null; }
  async ensure(settings: ConnectionSettings) {
    const s = { ...settings }; const key = this.key(s);
    if (siteOrigin(s.origin) !== siteOrigin(s.secretOrigin)) throw new Error("站点已变更，请在设置中保存该站的手册上传凭据。");
    if (this.value?.key === key) return this.value;
    if (this.pending?.key === key) return this.pending.promise;
    if (this.value || this.pending) this.clear();
    const generation = this.generation;
    const promise = (async () => {
      const token = this.secret(s.secretRef);
      if (!token) throw new Error("未找到已保存的凭据，请在 OPC手册管理器设置中重新填写。");
      const client = this.makeClient(s, token); const info = await client.get<ConnectionInfo>("connect");
      if (info.protocol !== HANDBOOK_PROTOCOL || info.scope !== "handbooks" || !info.imagesPublic || !info.capabilities?.includes("draft-upload-v2")) throw new Error("网站尚不支持新版草稿上传，请先更新网站，再重试读取线上状态。");
      siteOrigin(info.uploadOrigin);
      if (generation !== this.generation) throw new Error("连接配置已变更，请重试。");
      const value = { key, client, info }; this.value = value; return value;
    })();
    this.pending = { key, promise };
    try { return await promise; } finally { if (this.pending?.promise === promise) this.pending = null; }
  }
}
