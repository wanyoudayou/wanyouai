import { unified } from "unified";
import remarkParse from "remark-parse";
import { visit } from "unist-util-visit";
import { inspectMarkdown } from "@/lib/publishing/markdown";
import { canonicalMediaPath } from "@/lib/publishing/media-url";

export function projectPath(value: string) {
  const path = value.normalize("NFC");
  if (
    !path ||
    path.length > 1024 ||
    /[\\\x00-\x1f<>:#?]/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("目录路径无效，不能包含绝对路径或上级目录。");
  return path;
}
export function relativeAsset(document: string, reference: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    throw new Error("附件路径编码无效。");
  }
  if (/^(?:[a-z]+:|\/|\\)/i.test(decoded))
    throw new Error("附件必须使用项目相对路径。");
  const parts = document.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("附件路径超出专辑根目录。");
      parts.pop();
    } else parts.push(part);
  }
  return projectPath(parts.join("/"));
}
export const imageExtension = /\.(png|jpe?g|webp|gif|svg)$/i;
export const markdownExtension = /\.(md|markdown)$/i;
export function imageMime(path: string) {
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
        svg: "image/svg+xml",
      } as Record<string, string>
    )[path.split(".").pop()!.toLowerCase()] ?? ""
  );
}
export function normalizeEmbeds(source: string) {
  const tree = unified().use(remarkParse).parse(source);
  const code: [number, number][] = [];
  visit(tree, (node) => {
    if (node.type === "code" || node.type === "inlineCode")
      code.push([node.position!.start.offset!, node.position!.end.offset!]);
  });
  return source.replace(
    /!\[\[([^\]\n]+)\]\]/g,
    (whole, value: string, at: number) => {
      if (code.some(([start, end]) => at >= start && at < end)) return whole;
      const [path, size] = value.split("|");
      if (
        !imageExtension.test(path) ||
        (size && !/^\d{1,5}(?:x\d{1,5})?$/.test(size))
      )
        throw new Error(`不支持的嵌入：${value}。仅支持图片嵌入。`);
      return `![${path
        .split("/")
        .pop()!
        .replace(/[\\\[\]]/g, " ")}${size ? "|" + size : ""}](<${path}>)`;
    },
  );
}
export function localReferences(markdown: string, cover?: string) {
  return [
    ...new Set(
      [
        ...inspectMarkdown(markdown, "public").images.map((i) => i.url),
        ...(cover ? [cover] : []),
      ].filter((url) => !/^https?:\/\//i.test(url) && !canonicalMediaPath(url)),
    ),
  ];
}
export function insertImageText(url: string, alt: string) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    /\.(svg|pdf|mp4|mp3|webm|wav|ogg|mov)$/i.test(parsed.pathname)
  )
    throw new Error("请填写 HTTPS 位图地址。");
  return `![${alt.replace(/[\\\[\]\r\n]/g, " ")}](<${parsed.href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>)`;
}
