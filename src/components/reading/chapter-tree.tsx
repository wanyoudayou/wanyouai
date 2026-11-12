import Link from "next/link";
import { ArrowLeftIcon, LockIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChapterNavigation } from "@/types/reading";

export function ChapterTree({ navigation, onNavigate }: { navigation: ChapterNavigation; onNavigate?: () => void }) {
  return <nav className="flex-1 space-y-3 overflow-y-auto p-3" aria-label="章节目录">
    <Link href={navigation.backHref} onClick={onNavigate} className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground"><ArrowLeftIcon className="size-4" />返回栏目</Link>
    <p className="truncate px-2 text-sm font-medium" title={navigation.title}>{navigation.title}</p>
    {navigation.chapters.map((chapter) => <Link key={chapter.slug} href={chapter.href} onClick={onNavigate} aria-current={navigation.currentSlug === chapter.slug ? "page" : undefined} className={cn("flex items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-accent", navigation.currentSlug === chapter.slug && "bg-accent font-medium")}>
      {chapter.locked ? <LockIcon className="mt-1 size-3 shrink-0" aria-label="需解锁" /> : null}
      <span className="min-w-0 truncate" title={chapter.readme ? "内容介绍（README）" : chapter.title}>{chapter.readme ? "内容介绍（README）" : chapter.title}</span>
    </Link>)}
    {!navigation.chapters.length ? <p className="px-2 text-sm text-muted-foreground">编写中</p> : null}
  </nav>;
}
