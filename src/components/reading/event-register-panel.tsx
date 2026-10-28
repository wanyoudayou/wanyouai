"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { Eligibility } from "@/lib/events/eligibility";

export type RegisteredInfo = { status: string; checkin_token: string; qrSvg?: string | null };

/** 活动报名面板：按资格渲染 报名 / 购票 / 订阅引导 / 凭证；匿名引导登录。 */
export function EventRegisterPanel({
  seriesId,
  state,
  eligibility,
  registered,
  loggedIn,
}: {
  seriesId: number;
  state: string;
  eligibility: Eligibility | null;
  registered: RegisteredInfo | null;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(registered);
  const [state2, setState2] = useState<{ pending: boolean; message: string }>({ pending: false, message: "" });

  const register = async () => {
    setState2({ pending: true, message: "" });
    try {
      const res = await fetch("/api/events/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ series_id: seriesId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setCurrent({ status: data.status, checkin_token: data.checkin_token });
        setState2({ pending: false, message: "" });
      } else {
        setState2({ pending: false, message: data?.message ?? "报名失败，请稍后再试。" });
      }
    } catch {
      setState2({ pending: false, message: "网络异常，请稍后再试。" });
    }
  };

  const buyTicket = async () => {
    setState2({ pending: true, message: "" });
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku_type: "event", target_id: seriesId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.order?.id) {
        router.push(`/checkout/${data.order.id}`);
        return;
      }
      setState2({ pending: false, message: data?.message ?? "下单失败，请稍后再试。" });
    } catch {
      setState2({ pending: false, message: "网络异常，请稍后再试。" });
    }
  };

  // 已报名：凭证卡
  if (current && current.status !== "cancelled") {
    return (
      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm" data-testid="registration-pass">
        <p className="font-medium">{current.status === "attended" ? "已到场核销 ✓" : "报名成功 ✓"}</p>
        {current.status !== "attended" && current.qrSvg ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">现场出示下方二维码给站主扫码核销（建议截图保存），核销后活动纪要将自动解锁：</p>
            <div className="inline-block rounded-lg bg-white p-2 shadow-xs" dangerouslySetInnerHTML={{ __html: current.qrSvg }} aria-label="核销二维码" />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">到场时请向工作人员出示本页（或下方核销链接），核销后活动纪要将自动解锁。</p>
        )}
        <p className="break-all text-xs"><Link className="underline" href={`/checkin/${current.checkin_token}`}>核销链接（备用，点击或出示）</Link></p>
      </div>
    );
  }

  if (state === "ended") return <p className="text-sm text-muted-foreground">活动已结束，感谢关注。</p>;
  if (state !== "registering") return <p className="text-sm text-muted-foreground">报名尚未开始，可先收藏本页。</p>;
  if (!loggedIn) return <div className="space-y-2"><Button size="sm" asChild><Link href="/login">登录后报名</Link></Button><p className="text-xs text-muted-foreground">注册即可，无需付费。</p></div>;

  if (eligibility?.action === "buy_ticket") {
    return (
      <div className="space-y-2">
        <Button size="sm" onClick={buyTicket} disabled={state2.pending}>{state2.pending ? "创建订单…" : `购票 ¥${eligibility.price} 后报名`}</Button>
        <p className="text-xs text-muted-foreground">支付完成后回到本页点击「立即报名」。</p>
        {state2.message && <p role="alert" className="text-xs text-destructive">{state2.message}</p>}
      </div>
    );
  }
  if (eligibility?.action === "subscription_required") {
    return <p className="text-sm text-muted-foreground">本活动为会员专享，订阅后即可免费报名。</p>;
  }
  return (
    <div className="space-y-2">
      <Button size="sm" onClick={register} disabled={state2.pending}>{state2.pending ? "报名中…" : "立即报名"}</Button>
      {state2.message && <p role="alert" className="text-xs text-destructive">{state2.message}</p>}
    </div>
  );
}
