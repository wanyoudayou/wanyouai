import Link from "next/link";
import { ReadingActions } from "@/components/reading/reading-actions";

export function ArticleFooter({ owner, series, discussion = true }: { owner: string; series?: { href: string; title: string }; discussion?: boolean }) {
  return <footer className="mt-10 space-y-4 border-t pt-6 text-sm text-muted-foreground">
    <p>© {owner}{series ? <> · 所属内容：<Link href={series.href} className="underline underline-offset-4">{series.title}</Link></> : null}</p>
    <ReadingActions discussion={discussion} />
  </footer>;
}
