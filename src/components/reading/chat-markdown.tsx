"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkHeadingIds } from "@/lib/reading/markdown";
import { ContentImage } from "@/components/reading/content-image";

/** 分身气泡的 Markdown 渲染：与正文同一 react-markdown 管线（不含 mermaid 服务端渲染分支，图表以代码块原样展示）。 */
export function ChatMarkdown({ markdown, allowImages = true }: { markdown: string; allowImages?: boolean }) {
  return (
    <div className="reading-prose chat-prose-sm">
      <Markdown skipHtml remarkPlugins={[remarkGfm, remarkHeadingIds]} components={{
        img: ({ src, alt }) => allowImages ? <ContentImage src={typeof src === "string" ? src : ""} alt={alt} /> : <span>[图片：{alt || "未自动加载"}]</span>,
        a: ({ href, children }) => <a href={href} rel="noreferrer">{children}</a>,
        table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
      }}>{markdown}</Markdown>
    </div>
  );
}
