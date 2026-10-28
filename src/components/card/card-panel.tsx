import Link from "next/link";
import {
  ArrowUpRightIcon,
  BadgeCheckIcon,
  BanIcon,
  ClockIcon,
  FileTextIcon,
  PackageIcon,
  TargetIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { OwnerAvatar } from "@/components/shared/owner-avatar";
import { formatPrice } from "@/lib/format";
import { SOCIAL_PLATFORMS } from "@/types/site";
import type { CardPanelData } from "@/types/panel";

/**
 * 名片卡片区（页面契约 3.11 的同源渲染）：
 * 完整形态 = /card 中列内容卡片（供给 / 约束 / 不接 / 协议 / 实证）；
 * compact = 右栏分身面板的轻量名片。
 * 一处组件两处表面（compact 用于首页右栏占位）。
 */

/** 内容卡片（中列卡片式分区的统一容器）。 */
function SectionCard({ label, Icon, children }: { label: string; Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs" aria-label={label}>
      <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </h2>
      {children}
    </section>
  );
}

export function CardPanel({ card, currency = "CNY", compact = false }: { card: CardPanelData; currency?: string; compact?: boolean }) {
  // compact = 右栏分身面板的轻量名片：头像居中 + 简化分区
  if (compact) {
    return (
      <div className="space-y-5 text-sm">
        <div className="flex justify-center">
          <OwnerAvatar url={card.avatarUrl} name={card.ownerName} />
        </div>
        <dl className="space-y-3">
          <CompactRow label="身份" Icon={UserIcon}>{card.ownerName}{card.languages.length > 0 ? ` · ${card.languages.join(" / ")}` : ""}{card.timezone ? ` · ${card.timezone}` : ""}</CompactRow>
          {card.focusAreas.length > 0 ? (
            <CompactRow label="专注领域" Icon={TargetIcon}>
              <span className="flex flex-wrap gap-1">
                {card.focusAreas.map((area) => (
                  <Badge key={area} variant="outline" className="font-normal text-muted-foreground">{area}</Badge>
                ))}
              </span>
            </CompactRow>
          ) : null}
          <CompactRow label="供给" Icon={PackageIcon}>
            专辑 {card.seriesCount} · 文章 {card.articleCount}{card.subscriptionPriceText ? ` · 订阅 ${card.subscriptionPriceText}` : ""}
            {card.services.length > 0 ? (
              <span className="mt-1 flex flex-col gap-0.5">
                {card.services.map((service) => (
                  <Link key={service.slug} href={`/services/${service.slug}`} className="underline-offset-4 hover:text-foreground hover:underline">
                    服务：{service.title}{service.price !== null ? `（${formatPrice(service.price, currency)}）` : ""}
                  </Link>
                ))}
              </span>
            ) : null}
          </CompactRow>
          {card.workingHours || card.responseTime || card.currentLoad ? (
            <CompactRow label="约束" Icon={ClockIcon}>
              <span className="flex flex-col gap-0.5">
                {card.workingHours ? <span>{card.workingHours}</span> : null}
                {card.responseTime ? <span>{card.responseTime}</span> : null}
                {card.currentLoad ? <span>{card.currentLoad}</span> : null}
              </span>
            </CompactRow>
          ) : null}
          {card.exclusions.length > 0 ? <CompactRow label="不接" Icon={BanIcon}>{card.exclusions.join("、")}</CompactRow> : null}
        </dl>
      </div>
    );
  }

  // 完整形态：中列内容卡片（dinq 式）
  return (
    <div className="space-y-4">
      <SectionCard label="供给" Icon={PackageIcon}>
        <p className="text-sm">
          <span className="text-base font-medium">{card.seriesCount}</span> 专辑 ·{" "}
          <span className="text-base font-medium">{card.articleCount}</span> 篇文章
          {card.subscriptionPriceText ? ` · 订阅 ${card.subscriptionPriceText}` : ""}
        </p>
        {card.services.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {card.services.map((service) => (
              <Link
                key={service.slug}
                id={`service-${service.slug}`}
                href={`/services/${service.slug}`}
                className="block rounded-lg border p-3 transition-shadow hover:shadow-sm"
              >
                <span className="block text-xs text-muted-foreground">服务</span>
                <span className="block text-sm font-medium">{service.title}</span>
                {service.price !== null ? <span className="mt-0.5 block text-xs text-muted-foreground">{formatPrice(service.price, currency)}</span> : null}
                {service.protocol?.scope ? <span className="mt-1 block text-xs text-muted-foreground">范围：{service.protocol.scope}</span> : null}
              </Link>
            ))}
          </div>
        ) : null}
      </SectionCard>

      {card.workingHours || card.responseTime || card.currentLoad ? (
        <SectionCard label="约束" Icon={ClockIcon}>
          <ul className="space-y-1 text-sm">
            {card.workingHours ? <li>{card.workingHours}</li> : null}
            {card.responseTime ? <li>{card.responseTime}</li> : null}
            {card.currentLoad ? <li>{card.currentLoad}</li> : null}
          </ul>
        </SectionCard>
      ) : null}

      {card.exclusions.length > 0 ? (
        <SectionCard label="不接" Icon={BanIcon}>
          <p className="text-sm">{card.exclusions.join("、")}</p>
        </SectionCard>
      ) : null}

      <SectionCard label="协议" Icon={FileTextIcon}>
        <ul className="space-y-1 text-sm">
          <li>询价时请说明：你的需求、预算区间、期望时间，以及相关参考链接</li>
          {card.email ? (
            <li>
              <Link href={`mailto:${card.email}`} className="underline-offset-4 hover:text-foreground hover:underline">
                {card.email}
              </Link>
            </li>
          ) : null}
          {card.bookingUrl ? (
            <li>
              <Link href={card.bookingUrl} className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
                预约通道 <ArrowUpRightIcon className="size-3" aria-hidden />
              </Link>
            </li>
          ) : null}
        </ul>
      </SectionCard>

      {/* 自媒体平台露出：一个平台一张独立卡片 */}
      {card.socialLinks.map((link) => (
        <a
          key={link.platform + link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-xs transition-shadow hover:shadow-sm"
        >
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            {SOCIAL_PLATFORMS[link.platform].mark}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">{SOCIAL_PLATFORMS[link.platform].label}</span>
            <span className="block truncate text-sm font-medium">{link.label}</span>
            {link.note ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{link.note}</span> : null}
          </span>
          <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </a>
      ))}

      <SectionCard label="实证" Icon={BadgeCheckIcon}>
        {card.evaluations.length > 0 ? (
          <ul className="mb-3 space-y-3" aria-label="客户评价">
            {card.evaluations.map((evaluation) => (
              <li key={evaluation.id} className="text-sm">
                <p className="text-xs text-muted-foreground" aria-label={`${evaluation.rating} 星`}>{"★".repeat(evaluation.rating)}<span className="opacity-30">{"★".repeat(5 - evaluation.rating)}</span> · {new Date(evaluation.created_at).toLocaleDateString("zh-CN")}</p>
                {evaluation.content ? <p className="mt-0.5 leading-[1.7]">{evaluation.content}</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">还没有公开的评价。</p>
        )}
      </SectionCard>
    </div>
  );
}

/** compact 形态用的轻量行（标签小字 + 图标 + 内容）。 */
function CompactRow({ label, Icon, children }: { label: string; Icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="text-sm leading-[1.7]">{children}</dd>
    </div>
  );
}
