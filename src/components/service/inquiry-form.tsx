"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TurnstileWidget } from "@/components/shared/turnstile-widget";

/** 服务询价表单：intent / 预算 / 期望交付 / 参考链接；匿名需留邮箱。 */
export function InquiryForm({ slug, loggedIn, turnstileSiteKey = null }: { slug: string; loggedIn: boolean; turnstileSiteKey?: string | null }) {
  const [state, setState] = useState<{ pending: boolean; message: string; ok: boolean }>({ pending: false, message: "", ok: false });
  const [token, setToken] = useState<string | null>(null);
  const [widgetKey, setWidgetKey] = useState(0);
  const needTurnstile = !loggedIn && !!turnstileSiteKey;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (needTurnstile && !token) return;
    const form = new FormData(event.currentTarget);
    setState({ pending: true, message: "", ok: false });
    try {
      const res = await fetch("/api/services/inquire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug,
          intent: String(form.get("intent") ?? ""),
          budget_range: String(form.get("budget_range") ?? ""),
          deadline: String(form.get("deadline") ?? ""),
          context_links: String(form.get("context_links") ?? "").split("\n").map((v) => v.trim()).filter(Boolean),
          contact_email: String(form.get("contact_email") ?? ""),
          ...(token ? { turnstile_token: token } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.ok) {
        setState({ pending: false, message: data?.message ?? "询价已提交。", ok: true });
        (event.target as HTMLFormElement).reset();
      } else {
        setState({ pending: false, message: data?.message ?? "提交失败，请稍后再试。", ok: false });
      }
    } catch {
      setState({ pending: false, message: "网络异常，请稍后再试。", ok: false });
    } finally { setToken(null); setWidgetKey(key => key + 1); }
  };

  if (state.ok) {
    return <p role="status" className="text-sm">{state.message}</p>;
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-sm">
        需求描述（做什么、背景、期望结果，至少 10 字）
        <textarea name="intent" required minLength={10} maxLength={2000} rows={4} className="block w-full rounded-md border bg-background p-2" placeholder="例如：我们正在做跨境家居的独立站，想请你诊断选品方向……" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">预算区间（选填）<Input name="budget_range" maxLength={120} placeholder="例如 3000–5000 元" /></label>
        <label className="block space-y-1 text-sm">期望交付时间（选填）<Input name="deadline" type="date" /></label>
      </div>
      <label className="block space-y-1 text-sm">参考链接（选填，每行一个 HTTPS 地址）<textarea name="context_links" rows={2} className="block w-full rounded-md border bg-background p-2" /></label>
      {!loggedIn && <label className="block space-y-1 text-sm">联系邮箱（必填，用于接收报价）<Input name="contact_email" type="email" required maxLength={200} /></label>}
      {needTurnstile && <TurnstileWidget key={widgetKey} siteKey={turnstileSiteKey!} action="inquiry" onToken={setToken} />}
      <Button type="submit" disabled={state.pending || (needTurnstile && !token)}>{state.pending ? "提交中…" : "提交询价"}</Button>
      {state.message && <p role="alert" className="text-sm text-destructive">{state.message}</p>}
    </form>
  );
}
