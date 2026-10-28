import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkHeadingIds } from "@/lib/reading/markdown";
import { ContentImage } from "@/components/reading/content-image";
import { MermaidDiagram } from "@/components/reading/mermaid-diagram";

/** 正文 / 预览共用服务端管线。HTML 不执行，图表不下发给客户端渲染器。 */
export function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="reading-prose">
      <Markdown skipHtml remarkPlugins={[remarkGfm, remarkHeadingIds]} components={{
        img: ({ src, alt }) => <ContentImage src={typeof src === "string" ? src : ""} alt={alt} />,
        a: ({ href, children }) => <a href={href} rel="noreferrer">{children}</a>,
        pre: ({ node, children }) => {
          const code = node?.children[0];
          if (code?.type === "element" && code.tagName === "code" && Array.isArray(code.properties.className) && code.properties.className.includes("language-mermaid")) {
            const source = code.children.flatMap((child) => child.type === "text" ? [child.value] : []).join("");
            return <MermaidDiagram source={source} />;
          }
          return <pre>{children}</pre>;
        },
        table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
      }}>{markdown}</Markdown>
    </div>
  );
}
