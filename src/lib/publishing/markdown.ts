import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { diagnostic, type Diagnostic } from "./types";

const marker = /<!--\s*paywall\s*-->/g;
const processor = unified().use(remarkParse).use(remarkGfm);
export function inspectMarkdown(markdown: string, access: string) {
  const tree = processor.parse(markdown) as Root;
  const diagnostics: Diagnostic[] = [];
  const cuts: number[] = [];
  const images: { url: string; start: number; end: number; alt: string }[] = [];
  const definitions = new Map<string, string>();
  visit(tree, "definition", (node) => { definitions.set(node.identifier, node.url); });
  visit(tree, (node, _index, parent) => {
    if (node.type === "html") {
      if (/^<!--\s*paywall\s*-->$/.test(node.value.trim()) && parent === tree) {
        cuts.push(node.position!.start.offset!);
      } else if (node.value.match(marker)) {
        diagnostics.push(diagnostic("PAYWALL_IGNORED", "此标记未作为预览边界；请将预览切点放在独立一行。", "/markdown", "warning"));
      }
      if (/<\s*(?:video|audio|iframe|object|embed|img|svg)\b/i.test(node.value)) {
        diagnostics.push(diagnostic("MEDIA_TYPE_BLOCKED", "请使用 Markdown 图片；不支持原始 HTML 媒体嵌入。", "/markdown"));
      }
    }
    if (node.type === "image" || node.type === "imageReference") {
      const url = node.type === "image" ? node.url : definitions.get(node.identifier);
      if (!url) diagnostics.push(diagnostic("MEDIA_MISSING", "图片引用没有对应定义。", "/markdown"));
      else images.push({ url, start: node.position!.start.offset!, end: node.position!.end.offset!, alt: node.alt ?? "" });
    }
    if (node.type === "text" && /!\[\[/.test(node.value)) {
      diagnostics.push(diagnostic("MEDIA_MISSING", "Obsidian 图片需先由发布客户端转换为 Markdown 图片和媒体清单。", "/markdown"));
    }
  });
  if (cuts.length > 1) diagnostics.push(diagnostic("MULTIPLE_PAYWALL_MARKERS", "已使用第一个预览切点，后续标记不影响阅读权限。", "/markdown", "warning"));
  if (!cuts.length && access === "paid") diagnostics.push(diagnostic("PAID_WITHOUT_PREVIEW", "未设置付费切点，公开预览为空。", "/markdown", "warning"));
  return { diagnostics, images, paywallOffsets: cuts, preview: access === "public" ? markdown : cuts.length ? markdown.slice(0, cuts[0]).trimEnd() : "" };
}
