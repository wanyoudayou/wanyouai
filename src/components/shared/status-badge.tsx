import { cva, type VariantProps } from "class-variance-authority";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { ArticleAccess } from "@/types/database";

/**
 * 徽章语义色唯一出口（Design Tokens §1.2 映射表的可执行化）。
 * 其余组件禁止自取语义色；实际颜色由 Design Tokens 维护。
 */

const statusBadgeVariants = cva("gap-1", {
  variants: {
    tone: {
      neutral: "border-transparent bg-muted text-muted-foreground",
      free: "border-transparent bg-muted text-muted-foreground",
      registered: "border-info/30 bg-transparent text-info",
      subscriber: "border-primary/40 bg-transparent text-primary",
      paid: "border-warning/30 bg-transparent text-warning",
      owned: "border-success/30 bg-transparent text-success",
      "event-upcoming": "border-transparent bg-muted text-muted-foreground",
      "event-registering": "border-success/30 bg-transparent text-success",
      "event-ended": "border-transparent bg-muted text-muted-foreground",
      paused: "border-warning/30 bg-transparent text-warning",
      // 通用语义（后台检查、诊断等非业务状态），避免借用权限/商品配色。
      info: "border-info/30 bg-transparent text-info",
      success: "border-success/30 bg-transparent text-success",
      warning: "border-warning/30 bg-transparent text-warning",
      danger: "border-destructive/40 bg-transparent text-destructive",
    },
  },
  defaultVariants: { tone: "free" },
});

export type StatusBadgeTone = NonNullable<
  VariantProps<typeof statusBadgeVariants>["tone"]
>;

export const ACCESS_BADGE_LABEL: Record<ArticleAccess, string> = {
  public: "免费",
  registered: "注册可读",
  subscriber: "订阅专享",
  paid: "单篇购买",
};

export const ACCESS_BADGE_TONE: Record<ArticleAccess, StatusBadgeTone> = {
  public: "free",
  registered: "registered",
  subscriber: "subscriber",
  paid: "paid",
};

export function AccessBadge({ access }: { access: ArticleAccess }) {
  return (
    <StatusBadge tone={ACCESS_BADGE_TONE[access]}>
      {ACCESS_BADGE_LABEL[access]}
    </StatusBadge>
  );
}

export function StatusBadge({
  tone,
  className,
  children,
}: {
  tone: StatusBadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  const owned = tone === "owned";
  return (
    <Badge
      variant="outline"
      className={cn(statusBadgeVariants({ tone }), className)}
    >
      {owned ? <CheckIcon aria-hidden /> : null}
      {children}
    </Badge>
  );
}
