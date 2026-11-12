import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A single link owns the surface and its pointer/keyboard states. */
export function ContentCard({
  href,
  children,
  className,
  kind,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  kind: string;
}) {
  return (
    <Link href={href} className="opc-content-link" data-card-kind={kind}>
      <Card className={cn("opc-content-card", className)}>{children}</Card>
    </Link>
  );
}

export function ContentCardChip({ children }: { children: ReactNode }) {
  return <span className="opc-content-card-chip">{children}</span>;
}

export function ContentCardAction({ children }: { children: ReactNode }) {
  return (
    <span className="opc-content-card-action" aria-hidden>
      <span>{children}</span>
      <ArrowRightIcon className="size-3.5" />
    </span>
  );
}
