"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** 就地购买 CTA（页面契约 2.5）：POST /api/orders → 201 进核对页；409 去 /me。 */
export function PurchaseButton({ skuType, targetId, label, enabled = true }: { skuType: "subscription" | "series" | "single" | "skill"; targetId?: number | null; label: string; enabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!enabled) return <Button size="sm" disabled title="在线收款配置完成后开通">{label}</Button>;
  async function buy() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku_type: skuType, ...(targetId != null ? { target_id: targetId } : {}) }) });
      if (response.status === 201) { const { order } = await response.json() as { order: { id: number } }; router.push(`/checkout/${order.id}`); return; }
      if (response.status === 409) { router.push("/me"); return; }
      const data = await response.json().catch(() => null) as { message?: string } | null;
      setMessage(data?.message ?? "暂时无法创建订单，请稍后重试。");
    } catch { setMessage("网络异常，请稍后重试。"); }
    setBusy(false);
  }
  return <span className="inline-flex flex-col gap-1"><Button size="sm" disabled={busy} onClick={buy}>{busy ? "正在创建订单…" : label}</Button>{message ? <p role="alert" className="text-xs text-muted-foreground">{message}</p> : null}</span>;
}
