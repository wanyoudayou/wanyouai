import { parseDocument, stringify } from "yaml";
import type { Frontmatter, PublishInput, Media } from "@/lib/publishing/types";
import { inspectMarkdown } from "@/lib/publishing/markdown";

export const EMPTY_FRONTMATTER: Frontmatter = { title: "", slug: "", type: "blog", access: "public" };
export function importMarkdown(source: string, filename = "", mode: "article" | "handbook" = "article") {
  if (source.length > 1_000_000) throw new Error("文件不能超过 100 万字符。");
  const text = source.replace(/^\uFEFF/, "");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  let values: Record<string, unknown> = {};
  if (/^---\r?\n/.test(text) && !match) throw new Error("文件开头的属性区缺少结束分隔线 ---。");
  if (match) {
    const document = parseDocument(match[1], { uniqueKeys: true });
    if (document.errors.length) throw new Error("文件属性格式不正确：" + document.errors[0].message.split("\n")[0]);
    try {
      const parsed: unknown = document.toJS({ maxAliasCount: 0 });
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      values = parsed as Record<string, unknown>;
    } catch { throw new Error("文件属性必须是简单字段对象，不能使用 YAML 引用。"); }
  }
  const explicitFields = Object.keys(values);
  // Handbook uploads cannot set website-owned classification or publication settings.
  const websiteFields = mode === "handbook" ? ["type", "access", "price", "series_slug", "published_at"] : [];
  const ignoredWebsiteFields = websiteFields.filter(key => key in values);
  for (const key of websiteFields) delete values[key];
  const markdown = match ? text.slice(match[0].length) : text;
  const name = filename.replace(/\.(?:md|markdown)$/i, "");
  const candidate = name.toLowerCase().replace(/[ _]+/g, "-");
  const frontmatter: Frontmatter = {
    ...EMPTY_FRONTMATTER,
    title: /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? name,
    slug: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate) && candidate.length >= 2 && candidate.length <= 120 ? candidate : "",
  };
  const strings = ["title", "slug", "summary", "cover", "series_slug", "published_at"] as const;
  for (const key of strings) {
    if (key in values) {
      if (typeof values[key] !== "string") throw new Error(`文件属性 ${key} 应为文本。`);
      frontmatter[key] = values[key];
    }
  }
  if ("type" in values) {
    if (values.type !== "blog" && values.type !== "chapter" && values.type !== "skill") throw new Error("type 只能是 blog、chapter 或 skill。");
    frontmatter.type = values.type;
  }
  if ("access" in values) {
    if (typeof values.access !== "string" || !["public", "registered", "subscriber", "paid"].includes(values.access)) throw new Error("access 必须是 public / registered / subscriber / paid。");
    frontmatter.access = values.access as Frontmatter["access"];
  }
  if ("price" in values) {
    if (typeof values.price !== "number" || !Number.isFinite(values.price)) throw new Error("price 应为数字。");
    frontmatter.price = values.price;
  }
  if ("tags" in values) {
    if (!Array.isArray(values.tags) || !values.tags.every((tag) => typeof tag === "string")) throw new Error("tags 应为文本数组。");
    frontmatter.tags = values.tags;
  }
  const known = [...strings, "type", "access", "price", "tags"] as string[];
  const ignored = [...ignoredWebsiteFields, ...Object.keys(values).filter((key) => !known.includes(key))];
  return { frontmatter, markdown, ignored, explicitFields };
}
export function exportMarkdown(frontmatter: Frontmatter, markdown: string) {
  return `---\n${stringify(frontmatter)}---\n\n${markdown}`;
}
export function replaceDraftImage(markdown: string, source: string, url: string) {
  let result = markdown;
  let replaced = false;
  for (const image of inspectMarkdown(markdown, "public").images.reverse()) {
    if (image.url !== source) continue;
    result = result.slice(0, image.start) + `![${image.alt.replace(/[\\\[\]\r\n]/g, " ")}](<${url}>)` + result.slice(image.end);
    replaced = true;
  }
  return { markdown: result, replaced };
}
export function mergeDraftMedia(media: Media[], next: Media) {
  return [...media.filter((item) => item.source_path !== next.source_path), next];
}
export function newPublication(frontmatter: Frontmatter, markdown: string, media: Media[]): PublishInput {
  return { client_request_id: crypto.randomUUID(), frontmatter: structuredClone(frontmatter), markdown, media: structuredClone(media) };
}
