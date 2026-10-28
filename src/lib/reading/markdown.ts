import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root, RootContent } from "mdast";

export interface OutlineHeading { id: string; title: string; depth: number }
function textOf(node: RootContent): string {
  if ("value" in node && node.type !== "html") return node.value;
  if ("children" in node) return node.children.map((child) => textOf(child as RootContent)).join("");
  if (node.type === "image") return node.alt ?? "";
  return "";
}
export function getOutline(markdown: string): OutlineHeading[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const headings: OutlineHeading[] = [];
  visit(tree, "heading", (node) => { headings.push({ id: `section-${headings.length + 1}`, title: textOf(node), depth: node.depth }); });
  return headings;
}
export function remarkHeadingIds() {
  return (tree: Root) => {
    let index = 0;
    visit(tree, "heading", (node) => {
      node.data = { ...node.data, hProperties: { id: `section-${++index}` } };
    });
  };
}
export function safeImageSource(src: string): string | null {
  if (/[\\\u0000-\u0020]/.test(src)) return null;
  if (!(src.startsWith("/") && !src.startsWith("//")) && !src.startsWith("https://")) return null;
  try {
    const url = new URL(src, "https://content.invalid");
    if (url.username || url.password || /\.(svg|pdf|mp4|webm|mp3|wav)$/i.test(url.pathname)) return null;
    return src;
  } catch { return null; }
}
