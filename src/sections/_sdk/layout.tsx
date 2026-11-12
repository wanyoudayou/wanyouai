import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** 栏目页面标题区：与站点其它页面相同的标题层级与留白。 */
export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-[1.7] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/** 栏目内容容器：宽版工作区，保留外壳左右栏。 */
export function SectionBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}
