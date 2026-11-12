import { AccessBadge, StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { ContentImage } from "@/components/reading/content-image";
import { formatDateTime } from "@/lib/format";
import type { ReadingArticle } from "@/types/reading";

export function ArticleHeader({ article, timezone, readme = false }: { article: ReadingArticle; timezone: string; readme?: boolean }) {
  return <header className="space-y-4">
    <h1 className="text-3xl leading-snug font-medium break-words">{article.title}</h1>
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {article.published_at ? <time dateTime={article.published_at}>{formatDateTime(article.published_at, timezone)}</time> : null}
      {readme ? <StatusBadge tone="free">公开介绍</StatusBadge> : article.type === "chapter" && article.access === "paid" ? <StatusBadge tone="paid">付费章节</StatusBadge> : <AccessBadge access={article.access} />}
      {article.status === "paused" ? <StatusBadge tone="paused">已停售</StatusBadge> : null}
      {article.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
    </div>
    {article.cover_url ? <ContentImage src={article.cover_url} /> : null}
  </header>;
}
