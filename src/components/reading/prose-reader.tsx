import "server-only";

import { MarkdownContent } from "@/components/reading/markdown-content";

export function ProseReader({ markdown }: { markdown: string }) {
  return <MarkdownContent markdown={markdown} />;
}
