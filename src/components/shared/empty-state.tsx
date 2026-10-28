import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 全站空态（契约模式 11 / Tokens §6.2）：
 * lucide 48px muted + 一句话 + 单动作（可选）。
 */
export function EmptyState({
  Icon,
  title,
  description,
  action,
}: {
  Icon: LucideIcon;
  title: string;
  description?: string | null;
  action?: { href: string; label: string } | null;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-8" aria-hidden />
      </span>
      <p className="text-base font-medium">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm leading-[1.7] text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <Button variant="outline" size="sm" className="mt-2" asChild>
          <a href={action.href}>{action.label}</a>
        </Button>
      ) : null}
    </div>
  );
}
