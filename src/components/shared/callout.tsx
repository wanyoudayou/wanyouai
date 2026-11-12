import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Callout（FlowUs 式，契约模式 9 / Tokens §6.2）：
 * 1px 边框卡 + 图标位 + 标题/正文；paywall / 询价 / 通知块共用。
 */
export function Callout({
  Icon,
  title,
  children,
  className,
}: {
  Icon?: LucideIcon;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3 rounded-xl border p-4", className)}>
      {Icon ? (
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <div className="min-w-0 space-y-1">
        {title ? <p className="text-sm font-medium">{title}</p> : null}
        <div className="text-sm leading-[1.7] text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
