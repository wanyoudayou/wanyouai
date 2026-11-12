import { OutlineLinks } from "@/components/reading/outline-links";
import { getOutline } from "@/lib/reading/markdown";

export function PageOutline({ markdown }: { markdown: string }) {
  const headings = getOutline(markdown);
  return <OutlineLinks><nav aria-label="本页目录" className="space-y-2 p-4">
    {headings.length ? headings.map((heading) => <a key={heading.id} href={`#${heading.id}`} className={`block border-l-2 border-transparent pl-2 text-sm text-muted-foreground hover:text-primary aria-[current=location]:border-primary aria-[current=location]:text-primary ${heading.depth > 2 ? "pl-3" : ""}`}>{heading.title}</a>) : <p className="text-sm text-muted-foreground">本页暂无目录</p>}
  </nav></OutlineLinks>;
}
