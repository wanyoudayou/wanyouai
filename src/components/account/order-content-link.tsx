import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OrderContent } from "@/lib/orders/describe";

export function OrderContentLink({ content }: { content: OrderContent }) {
  if (!content.href) return (
    <p className="text-xs text-muted-foreground">内容暂不可用，可联系站主核对。</p>
  );
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={content.href}>
        {content.actionLabel}<ArrowUpRightIcon aria-hidden />
      </Link>
    </Button>
  );
}
