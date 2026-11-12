import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** grid gap-6；2–3 列自适应，<1024 单列（Design Tokens §6.2）。 */
export function CardGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3", className)}>
      {children}
    </div>
  );
}
