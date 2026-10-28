"use client";
import { useActionState, useState } from "react";
import { respondBooking } from "@/app/me/services/[id]/respond-actions";
import { Button } from "@/components/ui/button";

const initial = { ok: false, message: "" };

/** 客户侧报价响应：接受（即成单）/ 谢绝。 */
export function QuoteRespond({ bookingId }: { bookingId: number }) {
  const [state, action, pending] = useActionState(respondBooking, initial);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="accept_quote" />
          <Button size="sm" disabled={pending}>{pending ? "提交中…" : "接受报价（确认成交）"}</Button>
        </form>
        <form action={action}>
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="decline_quote" />
          <Button size="sm" variant="ghost" disabled={pending}>谢绝</Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground">接受即确认成交；签约与付款细节站主会与你线下确认。</p>
      {state.message && <p role="status" className="text-xs text-muted-foreground">{state.message}</p>}
    </div>
  );
}

/** 客户侧条款响应：同意（锁定不可变，解锁开工）/ 提出异议（退回站主草拟）。 */
export function AgreementRespond({ bookingId }: { bookingId: number }) {
  const [state, action, pending] = useActionState(respondBooking, initial);
  const [objectOpen, setObjectOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="accept_agreement" />
          <Button size="sm" disabled={pending}>{pending ? "提交中…" : "同意条款"}</Button>
        </form>
        <Button size="sm" variant="outline" onClick={() => setObjectOpen((v) => !v)}>{objectOpen ? "收起" : "提出异议"}</Button>
      </div>
      {objectOpen && (
        <form action={action} className="space-y-2">
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="object_agreement" />
          <textarea name="note" required minLength={5} maxLength={1000} rows={3} placeholder="请说明对条款的异议……" className="block w-full rounded-md border bg-background p-2 text-sm" />
          <Button size="sm" variant="outline" disabled={pending}>{pending ? "提交中…" : "提交异议（退回站主修改）"}</Button>
        </form>
      )}
      <p className="text-xs text-muted-foreground">同意后条款锁定不可再改，站主即可开工；有异议请写明，条款会退回站主修改后重新确认。</p>
      {state.message && <p role="status" className="text-xs text-muted-foreground">{state.message}</p>}
    </div>
  );
}

/** 客户侧检查点反馈：回应站主的需求请求（文字；素材贴链接；不作卡点）。 */
export function MilestoneRespond({ bookingId, milestoneId }: { bookingId: number; milestoneId: number }) {
  const [state, action, pending] = useActionState(respondBooking, initial);
  if (state.ok) return <p role="status" className="text-xs text-muted-foreground">{state.message || "已提交反馈"}</p>;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={bookingId} />
      <input type="hidden" name="action" value="respond_milestone" />
      <input type="hidden" name="milestone_id" value={milestoneId} />
      <textarea name="note" required maxLength={1000} rows={2} placeholder="回复站主的请求；素材可贴链接……" className="block w-full rounded-md border bg-background p-2 text-sm" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={pending}>{pending ? "提交中…" : "提交反馈"}</Button>
        {state.message && <p role="alert" className="text-xs text-muted-foreground">{state.message}</p>}
      </div>
    </form>
  );
}

/** 客户侧节点验收：确认验收 / 驳回（意见必填，节点退回站主返工）。 */
export function MilestoneAccept({ bookingId, milestoneId }: { bookingId: number; milestoneId: number }) {
  const [state, action, pending] = useActionState(respondBooking, initial);
  const [objectOpen, setObjectOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="accept_milestone" /><input type="hidden" name="milestone_id" value={milestoneId} />
          <Button size="sm" disabled={pending}>{pending ? "提交中…" : "确认验收"}</Button>
        </form>
        <Button size="sm" variant="outline" onClick={() => setObjectOpen((v) => !v)}>{objectOpen ? "收起" : "驳回"}</Button>
      </div>
      {objectOpen && (
        <form action={action} className="space-y-2">
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="object_milestone" /><input type="hidden" name="milestone_id" value={milestoneId} />
          <textarea name="note" required minLength={5} maxLength={1000} rows={2} placeholder="请说明驳回原因（必填，站主会收到并返工）……" className="block w-full rounded-md border bg-background p-2 text-sm" />
          <Button size="sm" variant="outline" disabled={pending}>{pending ? "提交中…" : "提交驳回"}</Button>
        </form>
      )}
      {state.message && <p role="status" className="text-xs text-muted-foreground">{state.message}</p>}
    </div>
  );
}

/** 客户侧交付响应：验收 / 要求修改（附修改意见，可多次）。 */
export function DeliveryRespond({ bookingId }: { bookingId: number }) {
  const [state, action, pending] = useActionState(respondBooking, initial);
  const [reviseOpen, setReviseOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="accept_delivery" />
          <Button size="sm" disabled={pending}>{pending ? "提交中…" : "验收通过"}</Button>
        </form>
        <Button size="sm" variant="outline" onClick={() => setReviseOpen((v) => !v)}>{reviseOpen ? "收起" : "要求修改"}</Button>
      </div>
      {reviseOpen && (
        <form action={action} className="space-y-2">
          <input type="hidden" name="id" value={bookingId} /><input type="hidden" name="action" value="request_revision" />
          <textarea name="note" required minLength={5} maxLength={1000} rows={3} placeholder="请说明需要修改的地方……" className="block w-full rounded-md border bg-background p-2 text-sm" />
          <Button size="sm" variant="outline" disabled={pending}>{pending ? "提交中…" : "提交修改意见"}</Button>
        </form>
      )}
      {state.message && <p role="status" className="text-xs text-muted-foreground">{state.message}</p>}
    </div>
  );
}
