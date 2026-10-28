"use client";

import { useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Optional hand-off of the public card to a web-capable AI; it grants no access. */
export function MachineCardLink({ url }: { url: string }) {
  const address = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function copy() {
    setBusy(true); setCopied(false); setMessage("");
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true); setMessage("名片链接已复制。");
    } catch {
      address.current?.focus(); address.current?.select();
      setMessage("无法自动复制，请选中名片地址后手动复制。");
    } finally { setBusy(false); }
  }
  return <details className="space-y-3 text-xs text-muted-foreground">
    <summary className="cursor-pointer hover:text-foreground">供 AI 读取</summary>
    <p className="leading-relaxed">可将公开名片链接交给支持网页访问的 AI，了解本站内容与服务；此链接不授予付费内容或私有文件的访问权限。</p>
    <Input ref={address} aria-label="公开名片地址" value={url} readOnly className="text-xs" />
    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void copy()}>
      {copied ? <CheckIcon /> : <CopyIcon />}{copied ? "已复制" : "复制名片链接"}
    </Button>
    <p role="status" aria-live="polite">{message}</p>
  </details>;
}
