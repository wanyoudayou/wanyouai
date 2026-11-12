"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkHeadingIds } from "@/lib/reading/markdown";
import { ContentImage } from "@/components/reading/content-image";

const external = (href: string | undefined) => !!href && /^https?:\/\//i.test(href);

/**
 * 分身气泡的 Markdown 渲染：与正文同一 react-markdown 管线（不含 mermaid 服务端渲染分支，图表以代码块原样展示）。
 * 模型输出默认不自动加载图片（避免第三方追踪与外传通道）；外链不传递排名并在新窗口打开，保留当前会话。
 */
export function ChatMarkdown({ markdown, allowImages = false }: { markdown: string; allowImages?: boolean }) {
  return (
    <div className="reading-prose chat-prose-sm">
      <Markdown skipHtml remarkPlugins={[remarkGfm, remarkHeadingIds]} components={{
        img: ({ src, alt }) => allowImages ? <ContentImage src={typeof src === "string" ? src : ""} alt={alt} /> : <span>[图片：{alt || "未自动加载"}]</span>,
        a: ({ href, children }) => external(href)
          ? <a href={href} rel="noreferrer nofollow ugc" target="_blank">{children}</a>
          : <a href={href}>{children}</a>,
        table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
      }}>{markdown}</Markdown>
    </div>
  );
}
