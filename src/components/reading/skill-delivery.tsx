"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyIcon, CheckIcon } from "lucide-react";
import type { SkillFile } from "@/lib/skills/package-policy";
export function SkillDelivery({ release, version }: { release: string; version: string }) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [url, setUrl] = useState(""); const [grant, setGrant] = useState<{ id: string; expiresAt: string; instruction: string } | null>(null);
  const [copied, setCopied] = useState(false);
  async function request(op: "download" | "install" | "revoke") {
    setBusy(true); setMessage(""); setUrl(""); setCopied(false);
    try {
      const response = await fetch("/api/skills/delivery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, release, ...(op === "revoke" ? { id: grant?.id } : {}) }), signal: AbortSignal.timeout(25000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      if (op === "download") { setUrl(result.url); setMessage(`下载地址已生成，${result.expiresIn} 秒内有效。`); }
      if (op === "revoke") { setGrant(null); setMessage(result.message); }
      if (op === "install") setGrant({ id: result.id, expiresAt: result.expiresAt, instruction: [
        `安装 Skill ${result.release.skill_name}，版本 ${result.release.version}。`,
        "先确认目标目录。若有同名文件先询问，不覆盖、不自动执行任何脚本。",
        `用 POST 请求 ${window.location.origin}/api/skills/install，授权仅放请求头：`,
        `Authorization: Bearer ${result.token}`,
        "响应中的下载地址短期有效；下载后校验 SHA-256，并核对文件清单及路径安全再解压。",
        `SHA-256: ${result.release.package_sha256}`,
        "文件清单：", ...result.release.manifest.map((f: SkillFile) => `${f.path} · ${f.size} bytes · ${f.sha256}`),
        `授权到期：${result.expiresAt}。此授权只用于本版本，不授予发布或账户管理权限。`,
      ].join("\n") });
    } catch (error) { setMessage(error instanceof Error ? error.message : "暂时无法下载。"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3"><div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => request("download")}>下载 v{version}</Button><Button disabled={busy} variant="outline" onClick={() => request("install")}>生成远程安装说明</Button></div>
    {url && <a className="inline-block text-sm text-primary underline" href={url} rel="noreferrer" referrerPolicy="no-referrer">保存 ZIP 文件</a>}
    {grant && <section className="min-w-0 space-y-3 rounded-lg border p-3"><h3 className="font-medium">远程安装说明</h3><p className="text-sm">把本段提示词发送给你使用的 Agent。</p><p className="text-xs text-muted-foreground">授权有效期 15 分钟，只交给你信任的 Agent。安装前确认目录和文件清单。</p><textarea readOnly aria-label="远程安装说明" className="h-56 w-full rounded border bg-background p-3 font-mono text-xs" value={grant.instruction} /><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(grant.instruction); setCopied(true); setMessage("安装提示词已复制。"); } catch { setCopied(false); setMessage("无法自动复制，请选中文本框中的全部内容后复制。"); } }}>{copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}{copied ? "已复制提示词" : "复制安装提示词"}</Button><Button variant="ghost" disabled={busy} onClick={() => request("revoke")}>撤销这次安装授权</Button></section>}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>;
}
