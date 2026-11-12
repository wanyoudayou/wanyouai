import Link from "next/link";
import type { PublishResponse } from "@/lib/publishing/types";
export function PublicationFeedback({ result, message }: { result: PublishResponse | null; message: string }) {
  return <div aria-live="polite" className="space-y-2 text-sm">
    {message && <p>{message}</p>}
    {result?.article && <p>已发布版本 {result.article.version} · <Link href={result.article.url} className="underline">查看文章</Link></p>}
    {result?.diagnostics.map((item, index) => <p key={index} className="break-words text-muted-foreground">{item.severity === "error" ? "需要修正" : "提示"}：{item.message} {item.path}</p>)}
  </div>;
}
