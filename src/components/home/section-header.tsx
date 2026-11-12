import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

/** 中栏区块头：标题 + 可选计数 + 可选「查看全部」。 */
export function SectionHeader({
  title,
  count,
  href,
  ctaLabel = "查看全部",
}: {
  title: string;
  count?: number | null;
  href?: string | null;
  ctaLabel?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="flex items-baseline gap-2 text-2xl leading-snug font-medium">
        {title}
        {typeof count === "number" ? (
          <span className="text-sm font-normal text-muted-foreground">{count}</span>
        ) : null}
      </h2>
      {href ? (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {ctaLabel}
          <ArrowRightIcon className="size-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}
