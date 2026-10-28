"use client";
import { useActionState, useState } from "react";
import { saveEventDetails } from "@/app/admin/manage-actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export type EventDetails = { starts_at: string; location_text: string | null; registration: string | null; capacity: string | null; kind: string; ticket_price: number | null; state: string };
/** 存储 ISO（含时区）→ datetime-local 显示值（浏览器本地时间）。 */
function toLocalInputValue(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EventDetailsForm({ id, updated, details }: { id: number; updated: string; details?: EventDetails }) {
  const [state, action, pending] = useActionState(saveEventDetails, { ok: false, message: "" });
  const current = details?.state ?? "upcoming";
  const [startsAtIso, setStartsAtIso] = useState(details?.starts_at ?? "");
  return <details open={!details} className="rounded-md border p-3"><summary className="cursor-pointer text-sm">活动详情（时间 / 地点 / 票价）</summary><form action={action} className="mt-4 space-y-3">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="updated" value={updated} />
    <fieldset disabled={pending} className="space-y-3">
      <label className="space-y-1 text-sm">开始时间
        <input
          type="datetime-local"
          required
          defaultValue={toLocalInputValue(details?.starts_at)}
          onChange={(event) => setStartsAtIso(event.target.value ? new Date(event.target.value).toISOString() : "")}
          className="block h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <input type="hidden" name="starts_at" value={startsAtIso} />
        <span className="block text-xs text-muted-foreground">按你电脑的本地时间选择，保存时自动转换为标准时间。</span>
      </label>
      <label className="space-y-1 text-sm">地点<Input name="location_text" maxLength={500} defaultValue={details?.location_text ?? ""} /></label>
      <label className="space-y-1 text-sm">报名说明<textarea name="registration" maxLength={3000} defaultValue={details?.registration ?? ""} className="block min-h-24 w-full rounded-md border bg-background p-2" /><span className="block text-xs text-muted-foreground">公开展示的说明，报名与支付尚未开通。</span></label>
      <label className="space-y-1 text-sm">名额说明<Input name="capacity" maxLength={200} defaultValue={details?.capacity ?? ""} /></label>
      <label className="space-y-1 text-sm">票价（元）<Input name="ticket_price" required type="number" min="0" max="999999.99" step="0.01" defaultValue={details?.ticket_price ?? 0} /></label>
      <label className="space-y-1 text-sm">活动类型<select name="kind" defaultValue={details?.kind ?? "open"} className="block w-full rounded-md border bg-background p-2"><option value="open">开放活动</option><option value="member">会员活动</option></select></label>
      <label className="space-y-1 text-sm">活动状态<select name="state" defaultValue={current} className="block w-full rounded-md border bg-background p-2"><option value={current}>{({ upcoming: "即将开始", registering: "报名中", ended: "已结束" } as Record<string, string>)[current]}</option>{details && current !== "ended" && <option value={current === "upcoming" ? "registering" : "ended"}>{current === "upcoming" ? "报名中" : "已结束"}</option>}</select></label>
    </fieldset><Button size="sm" disabled={pending}>{pending ? "保存中…" : "保存活动详情"}</Button><p role="status" className="text-sm">{state.message}</p>
  </form></details>;
}
