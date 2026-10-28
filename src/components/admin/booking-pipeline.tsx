"use client";
import { useActionState, useEffect, useState } from "react";
import {
  advanceBooking,
  quoteBooking,
  deliverBooking,
  bookDeal,
  sendAgreement,
  addMilestone,
  startMilestone,
  deliverMilestone,
  requestMilestone,
} from "@/app/admin/booking-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AdminPanelPortal,
  useAdminPanel,
} from "@/components/admin/admin-panel";
import { pendingParty, hasPendingRequest } from "@/lib/services/tracking";
import type { getBookingsData } from "@/lib/admin/bookings";

type Booking = Awaited<ReturnType<typeof getBookingsData>>["active"][number];
type Result = { ok: boolean; message: string };
const STATUS_LABEL: Record<string, string> = {
  inquiry: "询价",
  quoted: "已报价",
  booked: "已成交",
  in_progress: "交付中",
  delivered: "已交付",
  accepted: "已验收",
  settled: "已结案",
  declined: "已婉拒",
};
const STEPS: [string, string][] = [
  ["inquiry", "询价"],
  ["quoted", "报价"],
  ["booked", "成交"],
  ["in_progress", "交付"],
  ["delivered", "验收"],
  ["accepted", "结案"],
];
// 条款八项（双方主体与联系方式，加服务六要素）：先主体后六要素
const SIX_FIELDS: [string, string][] = [
  ["party_owner", "乙方主体与联系方式（服务方）"],
  ["party_client", "甲方主体与联系方式（客户）"],
  ["scope", "范围"],
  ["deliverable", "交付"],
  ["cadence", "节奏"],
  ["compensation", "酬劳"],
  ["exit", "退出"],
  ["ownership", "归属"],
];

const initial: Result = { ok: false, message: "" };

/** 逾期未完成的检查点高亮（借鉴 Fiverr 交付倒计时红旗）。 */
function isOverdue(ms: { expected_at: string | null; status: string }) {
  return (
    !!ms.expected_at &&
    ms.status !== "done" &&
    new Date(ms.expected_at + "T23:59:59") < new Date()
  );
}

/** 阶段步进条：明确当前所处环节，避免模块可见性与进度关系的误读。 */
function Stepper({ status }: { status: string }) {
  if (status === "declined") return null;
  const current =
    status === "settled"
      ? STEPS.length
      : STEPS.findIndex(([key]) => key === status);
  return (
    <ol
      aria-label="履约进度"
      className="flex flex-wrap items-center gap-1 text-xs"
    >
      {STEPS.map(([key, label], index) => (
        <li key={key} className="flex items-center gap-1">
          {index > 0 && (
            <span aria-hidden className="text-muted-foreground/50">
              →
            </span>
          )}
          <span
            className={
              index === current
                ? "rounded-full bg-primary px-2 py-0.5 font-medium text-primary-foreground"
                : index < current
                  ? "text-muted-foreground line-through"
                  : "text-muted-foreground/60"
            }
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

type Milestone = Booking["milestones"][number];

/**
 * 单个检查点行：状态机按钮组，替代自由下拉编辑——
 * 未开始 → [立即启动+预计日期]；进行中 → [节点交付+说明]/[请求支持+说明]；
 * 等待客户反馈 → 不鼓励操作，仅 [强制节点交付]；已交付 → 只读呈现历次请求/反馈与交付记录。
 */
function MilestoneRow({
  booking,
  ms,
  readOnly = false,
}: {
  booking: Booking;
  ms: Milestone;
  readOnly?: boolean;
}) {
  const [state, setState] = useState<Result>(initial);
  const [pending, setPending] = useState(false);
  const [openForm, setOpenForm] = useState<
    "start" | "deliver" | "request" | null
  >(null);
  const run =
    (action: (prev: Result, form: FormData) => Promise<Result>) =>
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (pending) return;
      setPending(true);
      setState(initial);
      try {
        const result = await action(initial, new FormData(event.currentTarget));
        setState(result);
        if (result.ok) setOpenForm(null);
      } finally {
        setPending(false);
      }
    };
  const hidden = (
    <>
      <input type="hidden" name="id" value={booking.id} />
      <input type="hidden" name="updated" value={booking.updated_at} />
      <input type="hidden" name="milestone_id" value={ms.id} />
    </>
  );
  const waiting = hasPendingRequest(ms);
  const done = ms.status === "done";
  const statusText = done
    ? ms.accepted_at
      ? "已验收 ✓"
      : "已交付 · 待客户验收"
    : waiting
      ? "等待客户反馈"
      : ms.status === "doing"
        ? ms.objection_note
          ? "返工中（客户已驳回）"
          : "进行中"
        : "未开始";

  return (
    <li className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-24 text-sm font-medium">{ms.title}</span>
        <StatusBadge tone={done ? "owned" : "free"}>{statusText}</StatusBadge>
        <span className="text-xs text-muted-foreground">
          {ms.expected_at ? `预计 ${ms.expected_at}` : ""}
          {ms.actual_at ? ` · 实际 ${ms.actual_at}` : ""}
        </span>
        {isOverdue(ms) && (
          <span className="text-xs font-medium text-destructive">已逾期</span>
        )}
      </div>

      {/* 动作按钮组（按状态；已结束订单只读） */}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {ms.status === "todo" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setOpenForm(openForm === "start" ? null : "start")}
            >
              立即启动
            </Button>
          )}
          {ms.status === "doing" && !waiting && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setOpenForm(openForm === "deliver" ? null : "deliver")
                }
              >
                节点交付
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setOpenForm(openForm === "request" ? null : "request")
                }
              >
                请求支持
              </Button>
            </>
          )}
          {ms.status === "doing" && waiting && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setOpenForm(openForm === "deliver" ? null : "deliver")
              }
            >
              强制节点交付（客户未反馈）
            </Button>
          )}
        </div>
      )}

      {/* 三个动作表单（同一时刻只开一个；说明均必填） */}
      {openForm === "start" && (
        <form
          onSubmit={run(startMilestone)}
          className="flex flex-wrap items-center gap-2"
        >
          {hidden}
          <label className="text-xs text-muted-foreground">
            预计完成日期（必填）
            <Input
              name="expected_at"
              type="date"
              required
              defaultValue={ms.expected_at ?? ""}
              className="ml-1 h-8 w-40 text-xs"
            />
          </label>
          <Button size="sm" disabled={pending}>
            {pending ? "启动中…" : "确认启动"}
          </Button>
        </form>
      )}
      {openForm === "deliver" && (
        <form onSubmit={run(deliverMilestone)} className="space-y-2">
          {hidden}
          <input type="hidden" name="milestone_title" value={ms.title} />
          <textarea
            name="note"
            required
            minLength={5}
            maxLength={1000}
            rows={2}
            placeholder="本节点交付了什么？在哪里查看？（必填）"
            className="block w-full rounded-md border bg-background p-2 text-sm"
          />
          <Button size="sm" disabled={pending}>
            {pending ? "提交中…" : waiting ? "强制交付此节点" : "交付此节点"}
          </Button>
        </form>
      )}
      {openForm === "request" && (
        <form onSubmit={run(requestMilestone)} className="space-y-2">
          {hidden}
          <input type="hidden" name="milestone_title" value={ms.title} />
          <textarea
            name="note"
            required
            minLength={5}
            maxLength={1000}
            rows={2}
            placeholder="需要客户提供什么支持？（素材可请其贴链接，必填）"
            className="block w-full rounded-md border bg-background p-2 text-sm"
          />
          <Button size="sm" variant="outline" disabled={pending}>
            {pending ? "发送中…" : "发送给客户"}
          </Button>
        </form>
      )}
      {state.message && (
        <p role="status" className="text-xs text-muted-foreground">
          {state.message}
        </p>
      )}

      {/* 交互记录：events 追加日志优先；无 events 的存量数据回落旧字段 */}
      <MilestoneEvents ms={ms} waiting={waiting} />
    </li>
  );
}

const EVENT_LABEL: Record<string, string> = {
  deliver: "节点交付",
  objection: "客户驳回",
  request: "请求支持",
  response: "客户反馈",
  accept: "客户验收",
};

function MilestoneEvents({ ms, waiting }: { ms: Milestone; waiting: boolean }) {
  const events = (ms.events ?? []) as {
    type: string;
    note?: string;
    at?: string;
  }[];
  if (events.length > 0) {
    return (
      <ol className="space-y-1 rounded-md bg-muted/30 p-2 text-xs">
        {events.map((event, i) => (
          <li
            key={i}
            className={
              event.type === "objection" ||
              (event.type === "request" && waiting && i === events.length - 1)
                ? "font-medium text-warning"
                : "text-muted-foreground"
            }
          >
            {EVENT_LABEL[event.type] ?? event.type}
            {event.at
              ? `（${new Date(event.at).toLocaleString("zh-CN")}）`
              : ""}
            {event.note ? `：${event.note}` : ""}
          </li>
        ))}
      </ol>
    );
  }
  if (!ms.client_request && !ms.completion_note) return null;
  return (
    <div className="space-y-1 rounded-md bg-muted/30 p-2 text-xs">
      {ms.completion_note && (
        <p>
          交付记录{ms.actual_at ? `（${ms.actual_at}）` : ""}：
          {ms.completion_note}
        </p>
      )}
      {ms.client_request && (
        <p
          className={
            waiting ? "font-medium text-warning" : "text-muted-foreground"
          }
        >
          已请求客户
          {ms.client_requested_at
            ? `（${new Date(ms.client_requested_at).toLocaleString("zh-CN")}）`
            : ""}
          {waiting ? " · 待反馈" : ""}：{ms.client_request}
        </p>
      )}
      {ms.client_response && (
        <p className="text-muted-foreground">
          客户反馈
          {ms.client_responded_at
            ? `（${new Date(ms.client_responded_at).toLocaleString("zh-CN")}）`
            : ""}
          ：{ms.client_response}
        </p>
      )}
      {ms.objection_note && (
        <p className="font-medium text-warning">
          客户驳回
          {ms.objected_at
            ? `（${new Date(ms.objected_at).toLocaleString("zh-CN")}）`
            : ""}
          ：{ms.objection_note}
        </p>
      )}
    </div>
  );
}

function BookingDetail({ booking }: { booking: Booking }) {
  const closed = booking.status === "settled" || booking.status === "declined";
  const [advanceState, advanceAction, advancing] = useActionState(
    advanceBooking,
    initial,
  );
  const [bookState, bookAction, booking2] = useActionState(bookDeal, initial);
  const [quoteState, quoteAction, quoting] = useActionState(
    quoteBooking,
    initial,
  );
  const [deliverState, deliverAction, delivering] = useActionState(
    deliverBooking,
    initial,
  );
  const [addState, addAction, adding] = useActionState(addMilestone, initial);
  const [sendState, sendAction, sending] = useActionState(
    sendAgreement,
    initial,
  );
  const quote = booking.quote_snapshot as {
    price?: number | null;
    plan?: string;
    delivery_date?: string;
    quoted_at?: string;
  } | null;
  const delivery = booking.delivery_snapshot as {
    note?: string;
    links?: string[];
    delivered_at?: string;
  } | null;
  const agreement = (booking.agreement_snapshot ?? null) as Record<
    string,
    string
  > | null;
  const revisions = (booking.revision_notes ?? []) as {
    note?: string;
    at?: string;
  }[];
  const hidden = (
    <>
      <input type="hidden" name="id" value={booking.id} />
      <input type="hidden" name="updated" value={booking.updated_at} />
    </>
  );
  const message =
    advanceState.message ||
    bookState.message ||
    quoteState.message ||
    deliverState.message ||
    addState.message ||
    sendState.message;

  return (
    <div className="space-y-6">
      <Stepper status={booking.status} />
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}

      <section className="space-y-1 text-sm">
        <h3 className="text-xs font-medium text-muted-foreground">需求</h3>
        <p className="whitespace-pre-wrap">{booking.intent}</p>
        <p className="text-xs text-muted-foreground">
          询价于 {new Date(booking.created_at).toLocaleString("zh-CN")}
          {booking.budget_range ? ` · 预算 ${booking.budget_range}` : ""}
          {booking.deadline ? ` · 期望交付 ${booking.deadline}` : ""}
          {booking.agreed_at ? ` · 签约 ${booking.agreed_at}` : ""}
        </p>
      </section>

      {/* 报价（inquiry/quoted 可发送或重发；之后只读展示） */}
      {!closed &&
        (booking.status === "inquiry" || booking.status === "quoted") && (
          <section className="space-y-3">
            <h3 className="text-xs font-medium text-muted-foreground">报价</h3>
            <form
              action={quoteAction}
              className="space-y-3 rounded-lg border p-3"
            >
              {hidden}
              <label className="block text-xs">
                方案要点（做什么、怎么做、交付什么）
                <textarea
                  name="plan"
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  defaultValue={quote?.plan ?? ""}
                  className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
                />
              </label>
              <label className="block text-xs">
                预计交付日期
                <Input
                  name="delivery_date"
                  type="date"
                  required
                  defaultValue={quote?.delivery_date ?? ""}
                  className="mt-1"
                />
              </label>
              <label className="block text-xs">
                报价金额（元，选填；非标可留空线下议）
                <Input
                  name="price"
                  type="number"
                  min="0"
                  max="99999999.99"
                  step="0.01"
                  defaultValue={quote?.price ?? ""}
                  className="mt-1"
                />
              </label>
              <Button size="sm" disabled={quoting}>
                {quoting
                  ? "发送中…"
                  : booking.status === "quoted"
                    ? "重发报价（覆盖上一版）"
                    : "发送报价并通知客户"}
              </Button>
            </form>
            <form action={advanceAction}>
              {hidden}
              <input type="hidden" name="next" value="declined" />
              <Button size="sm" variant="ghost" disabled={advancing}>
                婉拒
              </Button>
            </form>
          </section>
        )}
      {quote && !["inquiry", "declined"].includes(booking.status) && (
        <section className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
          <h3 className="text-xs font-medium text-muted-foreground">
            报价单
            {quote.quoted_at
              ? `（${new Date(quote.quoted_at).toLocaleString("zh-CN")}）`
              : ""}
          </h3>
          <p className="whitespace-pre-wrap">{quote.plan}</p>
          <p className="text-xs text-muted-foreground">
            {quote.price != null ? `报价 ${quote.price} 元 · ` : ""}预计交付{" "}
            {quote.delivery_date}
          </p>
        </section>
      )}

      {/* 条款生命周期：草拟（可编辑）→ 发送客户确认（锁定）→ 客户确认（不可变，开工解锁）；异议退回草拟 */}
      {(() => {
        const sent = !!booking.agreement_sent_at;
        const confirmed = !!booking.agreement_confirmed_at;
        const drafting =
          ["quoted", "booked"].includes(booking.status) && !sent && !confirmed;
        return (
          <>
            {!closed && drafting && (
              <section className="space-y-3">
                <h3 className="text-xs font-medium text-muted-foreground">
                  订单条款（草拟）
                </h3>
                <form
                  action={bookAction}
                  className="space-y-3 rounded-lg border p-3"
                >
                  {hidden}
                  <p className="text-xs text-muted-foreground">
                    已按服务「{booking.serviceTitle}
                    」的协议模板预填，可按本单实际情况修改；首次保存即成交并自动按交付清单创建里程碑。条款发送客户确认后锁定。
                  </p>
                  {SIX_FIELDS.map(([key, label]) => {
                    const fallback =
                      key === "party_owner"
                        ? booking.ownerParty
                        : key === "party_client"
                          ? booking.email
                          : (booking.serviceProtocol?.[key] ?? "");
                    return (
                      <label key={key} className="block text-xs">
                        {label}
                        <textarea
                          name={`agreement.${key}`}
                          required
                          rows={key.startsWith("party_") ? 1 : 2}
                          maxLength={600}
                          defaultValue={agreement?.[key] ?? fallback ?? ""}
                          className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
                        />
                      </label>
                    );
                  })}
                  <label className="block text-xs">
                    签约日期
                    <Input
                      name="agreed_at"
                      type="date"
                      required
                      defaultValue={booking.agreed_at ?? ""}
                      className="mt-1"
                    />
                  </label>
                  <Button size="sm" variant="outline" disabled={booking2}>
                    {booking2 ? "保存中…" : "保存条款草稿"}
                  </Button>
                </form>
                {agreement && (
                  <form action={sendAction}>
                    {hidden}
                    <Button size="sm" disabled={sending}>
                      {sending ? "发送中…" : "发送条款给客户确认"}
                    </Button>
                  </form>
                )}
              </section>
            )}
            {agreement && !drafting && (
              <section className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
                <h3 className="text-xs font-medium text-muted-foreground">
                  订单条款
                  {booking.agreed_at ? `（签约于 ${booking.agreed_at}）` : ""}
                  {confirmed ? (
                    <span className="ml-2 text-success">✓ 客户已确认</span>
                  ) : sent ? (
                    <span className="ml-2 text-warning">
                      已发送，待客户确认
                    </span>
                  ) : null}
                </h3>
                <dl className="space-y-1">
                  {SIX_FIELDS.map(([key, label]) =>
                    agreement[key] ? (
                      <div key={key} className="flex gap-2">
                        <dt className="w-28 shrink-0 text-xs text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="text-xs">{agreement[key]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </section>
            )}
          </>
        );
      })()}

      {/* 开工闸：条款经客户确认才可开工 */}
      {!closed && booking.status === "booked" && (
        <section>
          {booking.agreement_confirmed_at ? (
            <form action={advanceAction}>
              {hidden}
              <input type="hidden" name="next" value="in_progress" />
              <Button size="sm" disabled={advancing}>
                开工（进入交付）
              </Button>
            </form>
          ) : (
            <p className="text-xs text-muted-foreground">
              {booking.agreement_snapshot
                ? booking.agreement_sent_at
                  ? "条款已发送，等待客户确认后开工。"
                  : "请先保存条款草稿并发送给客户确认。"
                : "客户已确认成交，请先完善上方的订单条款。"}
            </p>
          )}
        </section>
      )}

      {/* 里程碑检查点：成交后可见，唯一操作入口（成交登记里的里程碑计划文本框已移除） */}
      {[
        "booked",
        "in_progress",
        "delivered",
        "accepted",
        "settled",
        "declined",
      ].includes(booking.status) && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">
            里程碑检查点
          </h3>
          <ul className="space-y-3">
            {booking.milestones.map((ms) => (
              <MilestoneRow
                key={ms.id}
                booking={booking}
                ms={ms}
                readOnly={closed || booking.status !== "in_progress"}
              />
            ))}
          </ul>
          {["booked", "in_progress"].includes(booking.status) && (
            <form
              action={addAction}
              className="flex flex-wrap items-center gap-2 border-t pt-2"
            >
              {hidden}
              <Input
                name="title"
                required
                maxLength={200}
                placeholder="新检查点名称"
                className="h-8 w-40 text-xs"
              />
              <select
                name="owner_party"
                defaultValue="owner"
                aria-label="归属"
                className="rounded-md border bg-background p-1 text-xs"
              >
                <option value="owner">待站主</option>
                <option value="client">待客户</option>
              </select>
              <Input
                name="expected_at"
                type="date"
                aria-label="预计日期"
                className="h-8 w-36 text-xs"
              />
              <Button size="sm" variant="outline" disabled={adding}>
                添加
              </Button>
            </form>
          )}
        </section>
      )}

      {/* 交付：仅交付中可提交；已交付后只读展示 */}
      {!closed && booking.status === "in_progress" && (
        <section className="space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground">交付</h3>
          {(() => {
            const undone = booking.milestones.filter(
              (m) => m.status !== "done",
            );
            return undone.length > 0 ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                还有 {undone.length} 个检查点未完成（
                {undone.map((m) => m.title).join("、")}
                ）。可继续提交交付，建议先核对。
              </p>
            ) : null;
          })()}
          <form
            action={deliverAction}
            className="space-y-3 rounded-lg border p-3"
          >
            {hidden}
            <label className="block text-xs">
              交付说明
              <textarea
                name="note"
                required
                minLength={5}
                maxLength={2000}
                rows={3}
                className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
                placeholder="交付了什么、在哪里查看、注意事项……"
              />
            </label>
            <label className="block text-xs">
              交付链接（选填，每行一个 https 地址）
              <textarea
                name="links"
                rows={2}
                className="mt-1 block w-full rounded-md border bg-background p-2 text-sm"
              />
            </label>
            <Button size="sm" disabled={delivering}>
              {delivering
                ? "提交中…"
                : booking.milestones.some((m) => m.status !== "done")
                  ? `提前交付（还有 ${booking.milestones.filter((m) => m.status !== "done").length} 项未完成）`
                  : "提交交付并通知客户"}
            </Button>
          </form>
        </section>
      )}
      {delivery &&
        ["delivered", "accepted", "settled"].includes(booking.status) && (
          <section className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
            <h3 className="text-xs font-medium text-muted-foreground">
              交付单
              {delivery.delivered_at
                ? `（${new Date(delivery.delivered_at).toLocaleString("zh-CN")}）`
                : ""}
            </h3>
            <p className="whitespace-pre-wrap">{delivery.note}</p>
            {(delivery.links ?? []).length > 0 && (
              <ul className="list-inside list-disc text-xs text-muted-foreground">
                {(delivery.links ?? []).map((link) => (
                  <li key={link} className="break-all">
                    {link}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

      {revisions.length > 0 && (
        <section className="space-y-1 rounded-lg border border-warning/30 p-3 text-sm">
          <h3 className="text-xs font-medium text-warning">
            客户修改意见（{revisions.length}）
          </h3>
          <ul className="space-y-1">
            {revisions.map((r, i) => (
              <li key={i} className="text-xs">
                {r.note}
                <span className="text-muted-foreground">
                  {r.at ? ` · ${new Date(r.at).toLocaleString("zh-CN")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 验收与结案 */}
      {booking.status === "delivered" && (
        <p className="text-xs text-muted-foreground">
          已交付，请等待客户在订单追踪页验收或要求修改。
        </p>
      )}
      {!closed && booking.status === "accepted" && (
        <form action={advanceAction}>
          {hidden}
          <input type="hidden" name="next" value="settled" />
          <Button size="sm" disabled={advancing}>
            结案
          </Button>
        </form>
      )}
    </div>
  );
}

/** 履约订单：主列表只读条目与状态，操作在右侧栏详情面板；已结束订单底部折叠区只读存档。 */
export function BookingPipeline({
  bookings,
  closed = [],
}: {
  bookings: Booking[];
  closed?: Booking[];
}) {
  const { show, close } = useAdminPanel();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected =
    bookings.find((b) => b.id === selectedId) ??
    closed.find((b) => b.id === selectedId) ??
    null;
  // 订单离开列表（结案/婉拒）后自动收起面板
  useEffect(() => {
    if (selectedId !== null && !selected) close();
  }, [selectedId, selected, close]); // 结案后从 active 移入 closed 时 selected 仍存在，不收起

  if (bookings.length === 0 && closed.length === 0)
    return (
      <p className="text-sm text-muted-foreground">暂无进行中的服务订单。</p>
    );
  return (
    <>
      {bookings.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无进行中的服务订单。</p>
      )}
      {bookings.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {bookings.map((booking) => {
            const pending = pendingParty(booking.status, booking.milestones);
            return (
              <li key={booking.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-muted/40"
                  onClick={(event) => {
                    setSelectedId(booking.id);
                    show(
                      `${booking.serviceTitle} · ${booking.email}`,
                      event.currentTarget,
                    );
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {booking.serviceTitle}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {booking.email}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {pending.party !== "—"
                        ? `当前：${pending.party}${pending.milestoneTitle ? `（${pending.milestoneTitle}）` : ""} · `
                        : ""}
                      更新于{" "}
                      {new Date(booking.updated_at).toLocaleDateString("zh-CN")}
                    </span>
                  </span>
                  <StatusBadge
                    tone={
                      ["accepted", "delivered"].includes(booking.status)
                        ? "owned"
                        : "free"
                    }
                  >
                    {STATUS_LABEL[booking.status] ?? booking.status}
                  </StatusBadge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {closed.length > 0 && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer p-4 text-sm text-muted-foreground">
            已结束订单（{closed.length}）——已结案与已婉拒，点击可查看只读存档
          </summary>
          <ul className="divide-y border-t">
            {closed.map((booking) => (
              <li key={booking.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-muted/40"
                  onClick={(event) => {
                    setSelectedId(booking.id);
                    show(
                      `${booking.serviceTitle} · ${booking.email}（只读）`,
                      event.currentTarget,
                    );
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">
                      {booking.serviceTitle}{" "}
                      <span className="text-muted-foreground">
                        · {booking.email}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      结束于{" "}
                      {new Date(booking.updated_at).toLocaleDateString("zh-CN")}
                    </span>
                  </span>
                  <StatusBadge
                    tone={booking.status === "settled" ? "owned" : "free"}
                  >
                    {booking.status === "settled" ? "已结案" : "已婉拒"}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <AdminPanelPortal>
        {selected ? (
          <BookingDetail
            key={`${selected.id}-${selected.updated_at}`}
            booking={selected}
          />
        ) : null}
      </AdminPanelPortal>
    </>
  );
}
