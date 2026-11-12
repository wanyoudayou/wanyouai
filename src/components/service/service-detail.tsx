import Link from "next/link";
import { MessagesSquareIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InquiryForm } from "@/components/service/inquiry-form";
import { Callout } from "@/components/shared/callout";
import { formatPrice } from "@/lib/format";
import type { ServiceDetailData } from "@/lib/get-services";
import type { ConstraintsConfig, ContactConfig } from "@/types/site";

/**
 * 服务详情（页面契约 3.7）：六要素块 → 约束块 → 询价块→ 流程说明。
 * 构成见 Design Tokens §6.2（ServiceDetail）。
 */

const PROTOCOL_KEY_LABELS: Record<string, string> = {
  scope: "服务范围",
  deliverable: "交付标准",
  cadence: "节奏",
  compensation: "结算方式",
  exit: "退出条件",
  ownership: "成果归属",
};

function Definition({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-[1.7]">{children}</dd>
    </div>
  );
}

export function ServiceDetail({
  service,
  constraints,
  contact,
  currency,
  loggedIn,
  turnstileSiteKey = null,
  evaluations = [],
}: {
  service: ServiceDetailData;
  constraints: ConstraintsConfig;
  contact: ContactConfig;
  currency: string;
  loggedIn: boolean;
  turnstileSiteKey?: string | null;
  /** 交易锚定评价（已结案订单；公开展示，不含个人信息）。 */
  evaluations?: {
    id: number;
    rating: number;
    content: string | null;
    created_at: string;
  }[];
}) {
  const contactHref =
    contact.bookingUrl ?? (contact.email ? `mailto:${contact.email}` : null);
  const contactLabel = contact.bookingUrl ? "预约沟通" : "邮件联系";

  return (
    <div className="flex flex-col gap-10">
      <header className="space-y-3">
        <h1 className="text-3xl leading-snug font-medium">{service.title}</h1>
        {service.summary ? (
          <p className="max-w-2xl text-base leading-[1.8] text-muted-foreground">
            {service.summary}
          </p>
        ) : null}
      </header>

      <section className="space-y-3" aria-label="服务六要素">
        <h2 className="text-2xl leading-snug font-medium">服务六要素</h2>
        <dl className="space-y-3 rounded-xl border p-5">
          <Definition label="交付物">
            <span className="flex flex-wrap gap-1.5">
              {service.deliverables.map((item) => (
                <Badge
                  key={item}
                  variant="outline"
                  className="font-normal text-muted-foreground"
                >
                  {item}
                </Badge>
              ))}
            </span>
          </Definition>
          <Definition label="工期">
            {service.duration ?? "按项目约定"}
          </Definition>
          <Definition label="价格">
            {service.price !== null ? (
              <span className="font-medium">
                {formatPrice(service.price, currency)}
              </span>
            ) : (
              "按报价"
            )}
          </Definition>
          <Definition label="容量">
            {service.capacityPerMonth !== null
              ? `每月限 ${service.capacityPerMonth} 单`
              : "不限"}
          </Definition>
          {service.protocolSnapshot
            ? Object.entries(service.protocolSnapshot).map(([key, value]) => (
                <Definition key={key} label={PROTOCOL_KEY_LABELS[key] ?? key}>
                  {value}
                </Definition>
              ))
            : null}
        </dl>
      </section>

      <section className="space-y-3" aria-label="约束">
        <h2 className="text-2xl leading-snug font-medium">约束</h2>
        <dl className="space-y-2 text-sm">
          {constraints.workingHours ? (
            <Definition label="工作时段">{constraints.workingHours}</Definition>
          ) : null}
          {constraints.responseTime ? (
            <Definition label="响应时间">{constraints.responseTime}</Definition>
          ) : null}
          {constraints.currentLoad ? (
            <Definition label="当前负载">{constraints.currentLoad}</Definition>
          ) : null}
          {constraints.exclusions.length > 0 ? (
            <Definition label="不接事项">
              {constraints.exclusions.join("、")}
            </Definition>
          ) : null}
        </dl>
      </section>

      {evaluations.length > 0 && (
        <section
          aria-label="客户评价"
          className="space-y-3 rounded-xl border p-5"
        >
          <h2 className="text-base font-medium">
            客户评价（{evaluations.length}）
          </h2>
          <ul className="space-y-3">
            {evaluations.map((evaluation) => (
              <li key={evaluation.id} className="space-y-1 text-sm">
                <p
                  className="text-warning"
                  aria-label={`${evaluation.rating} 星`}
                >
                  {"★".repeat(evaluation.rating)}
                  <span className="text-muted-foreground/30">
                    {"★".repeat(5 - evaluation.rating)}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Date(evaluation.created_at).toLocaleDateString(
                      "zh-CN",
                    )}
                  </span>
                </p>
                {evaluation.content ? (
                  <p className="leading-[1.7] text-muted-foreground">
                    {evaluation.content}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Callout Icon={MessagesSquareIcon} title="询价">
        <p className="text-xs">
          流程：询价 → 报价 → 线下确认签约付款 → 成交登记 → 里程碑追踪。
          {contactHref ? (
            <>
              也可以直接
              <Button variant="link" size="sm" className="px-1" asChild>
                <Link href={contactHref}>{contactLabel}</Link>
              </Button>
              。
            </>
          ) : null}
        </p>
        <InquiryForm slug={service.slug} loggedIn={loggedIn} turnstileSiteKey={turnstileSiteKey} />
      </Callout>
    </div>
  );
}
