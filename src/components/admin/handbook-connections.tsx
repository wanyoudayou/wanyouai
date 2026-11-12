"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
type Connection = { id: string; name: string; created_at: string; last_used_at: string | null };
export function HandbookConnections() {
  const [items, setItems] = useState<Connection[]>([]); const [name, setName] = useState(""); const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function load() { const response = await fetch("/api/admin/handbook-credentials", { cache: "no-store", signal: AbortSignal.timeout(15000) }); const data = await response.json(); if (!response.ok) throw new Error(data.message); return data.items as Connection[]; }
  useEffect(() => { let active = true; void load().then(data => { if (active) setItems(data); }).catch(() => { if (active) setMessage("连接列表暂时不可读，请刷新页面。"); }); return () => { active = false; }; }, []);
  async function run(body: object) { setBusy(true); setMessage(""); try { const response = await fetch("/api/admin/handbook-credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }); const data = await response.json(); if (!response.ok) throw new Error(data.message); if (data.token) { setToken(data.token); setName(""); } else setMessage("连接已撤销。"); setItems(await load()); } catch (error) { setMessage(error instanceof Error ? error.message : "操作未完成。"); } finally { setBusy(false); } }
  return <div className="space-y-6"><form className="space-y-3" onSubmit={e => { e.preventDefault(); void run({ op: "create", name }); }}><label className="block space-y-2 text-sm">连接名称<Input value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="例如我的 Obsidian 笔记库" /></label><Button disabled={busy || !name.trim() || !!token}>创建手册上传凭据</Button></form>
    {token && <section className="space-y-3 rounded-lg border p-4"><p className="text-sm">此凭据仅显示一次。请在 Obsidian 插件中用 SecretStorage 保存；它可读取、上传本网站的手册草稿及相关公开图片，不能发布、上架、删除文稿或管理其他业务。</p><Input readOnly aria-label="手册上传凭据" value={token} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(token); setMessage("已复制，请粘贴到 Obsidian 凭据存储。"); } catch { setMessage("请选中输入框自行复制。"); } }}>复制凭据</Button><Button variant="ghost" onClick={() => setToken("")}>已保存，隐藏凭据</Button></section>}
    <ul className="divide-y">{items.map(item => <li className="flex items-center justify-between gap-4 py-4" key={item.id}><span>{item.name}<span className="ml-3 text-xs text-muted-foreground">{item.last_used_at ? "已使用" : "尚未连接"}</span></span><Button variant="outline" disabled={busy} onClick={() => run({ op: "revoke", id: item.id })}>撤销连接</Button></li>)}</ul><p role="status" className="text-sm">{message}</p>
  </div>;
}
