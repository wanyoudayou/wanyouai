import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUserIdentity } from "@/lib/account/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  BOOKING_STAGES,
  pendingParty,
  hasPendingRequest,
  type MilestoneLike,
} from "@/lib/services/tracking";
import { EvaluationForm } from "@/components/service/evaluation-form";
import {
  QuoteRespond,
  DeliveryRespond,
  AgreementRespond,
  MilestoneRespond,
  MilestoneAccept,
} from "@/components/service/booking-respond";

export const metadata: Metadata = {
  title: "服务订单追踪",
  robots: { index: false, follow: false },
};

const EVENT_LABEL: Record<string, string> = {
  deliver: "站主交付",
  objection: "你的驳回",
  request: "站主请求",
  response: "你的反馈",
  accept: "你的验收",
};

const SIX_LABEL: Record<string, string> = {
  party_owner: "乙方（服务方）",
  party_client: "甲方（客户）",
  scope: "范围",
  deliverable: "交付",
  cadence: "节奏",
  compensation: "酬劳",
  exit: "退出",
  ownership: "归属",
};

/** 服务订单追踪（PRD §4.4 客户侧）：booked 起可见完整时间线；非当事人 404 不泄露存在性。 */
export default async function ServiceTrackingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const bookingId = Number((await params).id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) notFound();
  const { user } = await getUserIdentity();
  if (!user) redirect("/login");
  const client = await createSupabaseServerClient();
  // RLS bookings_own_read：非当事人查询为 0 行 → 404（与内容页同一不泄露口径）
  const { data: booking } = await client
    .from("bookings")
    .select(
      "id,service_id,email,intent,budget_range,deadline,status,agreement_snapshot,agreement_sent_at,agreement_confirmed_at,quote_snapshot,delivery_snapshot,revision_notes,agreed_at,created_at",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) notFound();
  const [{ data: svc }, { data: milestones }] = await Promise.all([
    client
      .from("services")
      .select("title")
      .eq("id", booking.service_id)
      .maybeSingle(),
    client
      .from("milestones")
      .select(
        "id,title,owner_party,expected_at,actual_at,status,sort,client_request,client_requested_at,client_response,client_responded_at,completion_note,accepted_at,objection_note,objected_at,events",
      )
      .eq("booking_id", booking.id)
      .order("sort")
      .order("id"),
  ]);
  const stage = BOOKING_STAGES[booking.status] ?? {
    label: booking.status,
    clientHint: "",
  };
  const list = (milestones ?? []) as MilestoneLike[];
  const pending = pendingParty(booking.status, list);
  const agreement = (booking.agreement_snapshot ?? null) as Record<
    string,
    string
  > | null;
  const quote = (booking.quote_snapshot ?? null) as {
    price?: number | null;
    plan?: string;
    delivery_date?: string;
    quoted_at?: string;
  } | null;
  const delivery = (booking.delivery_snapshot ?? null) as {
    note?: string;
    links?: string[];
    delivered_at?: string;
  } | null;
  const revisions = (booking.revision_notes ?? []) as {
    note?: string;
    at?: string;
  }[];
  const tracked = !["inquiry", "quoted", "declined"].includes(booking.status);
  const closed = ["settled", "declined"].includes(booking.status);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
      <Link href="/me" className="text-sm underline">
        返回我的权益
      </Link>
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          服务订单追踪 · #{booking.id}
        </p>
        <h1 className="text-2xl font-medium">{svc?.title ?? "服务"}</h1>
        <div className="flex items-center gap-3">
          <StatusBadge
            tone={
              ["delivered", "accepted", "settled"].includes(booking.status)
                ? "owned"
                : "free"
            }
          >
            {stage.label}
          </StatusBadge>
          {tracked && pending.party !== "—" && (
            <span className="text-sm text-muted-foreground">
              当前：{pending.party}
              {pending.milestoneTitle ? `（${pending.milestoneTitle}）` : ""}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{stage.clientHint}</p>
      </header>

      {tracked && pending.clientWaiting && (
        <p
          role="status"
          className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          当前等待你：{pending.milestoneTitle ?? "处理当前环节"}
          {pending.expectedAt ? `（预计 ${pending.expectedAt}）` : ""}
          。完成后站主才能继续推进。
        </p>
      )}

      {!tracked && (
        <section className="rounded-xl border p-4 text-sm space-y-2">
          <p>你的需求：{booking.intent}</p>
          {booking.budget_range && (
            <p className="text-muted-foreground">
              预算区间：{booking.budget_range}
            </p>
          )}
          <p className="text-muted-foreground">
            提交于 {new Date(booking.created_at).toLocaleString("zh-CN")}
          </p>
        </section>
      )}

      {booking.status === "quoted" && quote && (
        <section className="rounded-xl border p-4 space-y-3">
          <h2 className="text-sm font-medium">站主报价单</h2>
          <p className="text-sm whitespace-pre-wrap">{quote.plan}</p>
          <p className="text-sm text-muted-foreground">
            {quote.price != null ? `报价 ${quote.price} 元 · ` : ""}预计交付{" "}
            {quote.delivery_date}
          </p>
          <QuoteRespond bookingId={booking.id} />
        </section>
      )}

      {delivery &&
        ["delivered", "accepted", "settled"].includes(booking.status) && (
          <section className="rounded-xl border p-4 space-y-3">
            <h2 className="text-sm font-medium">
              交付单
              {delivery.delivered_at
                ? `（${new Date(delivery.delivered_at).toLocaleString("zh-CN")}）`
                : ""}
            </h2>
            <p className="text-sm whitespace-pre-wrap">{delivery.note}</p>
            {(delivery.links ?? []).length > 0 && (
              <ul className="list-inside list-disc space-y-1 text-sm">
                {(delivery.links ?? []).map((link) => (
                  <li key={link}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all underline underline-offset-4"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {booking.status === "delivered" && (
              <DeliveryRespond bookingId={booking.id} />
            )}
          </section>
        )}

      {revisions.length > 0 && (
        <section className="rounded-xl border p-4 space-y-2">
          <h2 className="text-sm font-medium">
            修改记录（{revisions.length}）
          </h2>
          <ul className="space-y-1 text-sm">
            {revisions.map((r, i) => (
              <li key={i}>
                {r.note}
                <span className="ml-1 text-xs text-muted-foreground">
                  {r.at ? new Date(r.at).toLocaleString("zh-CN") : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tracked && (
        <>
          {agreement && (
            <section className="rounded-xl border p-4 space-y-3">
              <h2 className="text-sm font-medium">
                订单条款
                {booking.agreed_at ? `（签约于 ${booking.agreed_at}）` : ""}
                {booking.agreement_confirmed_at ? (
                  <span className="ml-2 text-xs text-success">✓ 你已确认</span>
                ) : booking.agreement_sent_at ? (
                  <span className="ml-2 text-xs text-warning">待你确认</span>
                ) : (
                  <span className="ml-2 text-xs text-muted-foreground">
                    站主草拟中
                  </span>
                )}
              </h2>
              <dl className="space-y-1.5 text-sm">
                {Object.entries(SIX_LABEL).map(([key, label]) =>
                  agreement[key] ? (
                    <div key={key} className="flex gap-2">
                      <dt className="w-24 shrink-0 text-muted-foreground">
                        {label}
                      </dt>
                      <dd>{agreement[key]}</dd>
                    </div>
                  ) : null,
                )}
              </dl>
              {booking.status === "booked" &&
                booking.agreement_sent_at &&
                !booking.agreement_confirmed_at && (
                  <AgreementRespond bookingId={booking.id} />
                )}
            </section>
          )}
          <section className="space-y-3">
            <h2 className="text-sm font-medium">里程碑时间线</h2>
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                站主尚未配置检查点。
              </p>
            ) : (
              <ol className="space-y-3">
                {list.map((ms) => (
                  <li key={ms.id} className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={`mt-1.5 inline-block size-2.5 rounded-full ${ms.status === "done" ? "bg-primary" : ms.status === "doing" ? "bg-primary/40" : "bg-muted-foreground/30"}`}
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm">
                        {ms.title}{" "}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {PARTY_TEXT(ms.owner_party)}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ms.status === "done"
                          ? ms.accepted_at
                            ? "已验收 ✓"
                            : "已交付 · 待你验收"
                          : ms.status === "doing"
                            ? ms.objection_note && !ms.accepted_at
                              ? "返工中（你已驳回）"
                              : hasPendingRequest(ms)
                                ? "进行中 · 待你反馈"
                                : "进行中"
                            : "未开始"}
                        {ms.actual_at && ms.status === "done"
                          ? ` · 交付 ${ms.actual_at}`
                          : ""}
                        {ms.expected_at ? ` · 预计 ${ms.expected_at}` : ""}
                      </p>
                      {ms.completion_note && (
                        <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-2">
                          <p>
                            节点交付记录
                            {ms.actual_at ? `（${ms.actual_at}）` : ""}：
                            {ms.completion_note}
                          </p>
                          {!closed &&
                          ms.status === "done" &&
                          !ms.accepted_at &&
                          ms.id ? (
                            <MilestoneAccept
                              bookingId={booking.id}
                              milestoneId={ms.id}
                            />
                          ) : null}
                        </div>
                      )}
                      {(ms.events ?? []).length > 0 && (
                        <ol className="space-y-1 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                          {(ms.events ?? []).map((event, i) => (
                            <li
                              key={i}
                              className={
                                event.type === "objection"
                                  ? "font-medium text-warning"
                                  : ""
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
                      )}
                      {ms.objection_note && ms.status === "doing" && (
                        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                          你的驳回意见
                          {ms.objected_at
                            ? `（${new Date(ms.objected_at).toLocaleString("zh-CN")}）`
                            : ""}
                          ：{ms.objection_note}（站主返工后会重新交付）
                        </p>
                      )}
                      {ms.client_request && (
                        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm">
                          <p className="text-xs font-medium text-warning">
                            站主请求
                            {ms.client_requested_at
                              ? `（${new Date(ms.client_requested_at).toLocaleString("zh-CN")}）`
                              : ""}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap">
                            {ms.client_request}
                          </p>
                          {ms.client_response && !hasPendingRequest(ms) ? (
                            <p className="mt-2 border-t border-amber-200 pt-2 text-xs text-muted-foreground">
                              你的反馈：{ms.client_response}
                            </p>
                          ) : !closed && ms.id ? (
                            <div className="mt-2">
                              <MilestoneRespond
                                bookingId={booking.id}
                                milestoneId={ms.id}
                              />
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">
              检查点与等待期按实际情况呈现——承诺过程，不承诺结果。
            </p>
          </section>
          {booking.status === "settled" && (
            <section className="rounded-xl border p-4 space-y-2">
              <h2 className="text-sm font-medium">评价这次合作</h2>
              <EvaluationForm bookingId={booking.id} />
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PARTY_TEXT(party: string): string {
  return party === "owner"
    ? "待站主"
    : party === "client"
      ? "待你"
      : "待第三方";
}
