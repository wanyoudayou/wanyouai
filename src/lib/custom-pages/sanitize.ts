import sanitizeHtml from "sanitize-html";
import { isCustomPageIconName } from "./icon-names";

/**
 * 自定义页面 HTML 净化（保存时 + 渲染时双道）。
 * 白名单：结构/排版/表格/图片标签 + cp-* 语义类 + https/mailto/站内链接。
 * 禁 script / style / iframe / form / 事件属性 / 自由 class——动态 HTML 的样式能力
 * 只允许走 cp-* 语义类（globals.css 静态定义），这是安全与风格统一的边界。
 */

export const CP_CLASSES = [
  "cp-section",
  "cp-grid-2",
  "cp-grid-3",
  "cp-stack",
  "cp-center",
  "cp-h1",
  "cp-h2",
  "cp-h3",
  "cp-lead",
  "cp-muted",
  "cp-small",
  "cp-card",
  "cp-callout",
  "cp-badge",
  "cp-cta",
  "cp-cta-secondary",
  "cp-figure",
  "cp-img",
  "cp-divider",
  "cp-list-check",
  "cp-tint",
  "cp-inverse",
  "cp-link-cover",
  "cp-link-cover-body",
  "cp-social",
  "cp-social-mark",
  "cp-subscribe",
  "cp-pricing",
  "cp-icon",
] as const;

const CP_SET = new Set<string>(CP_CLASSES);

export const CP_TAGS = [
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "aside",
  "nav",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "a",
  "img",
  "ul",
  "ol",
  "li",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "mark",
  "small",
  "sub",
  "sup",
  "blockquote",
  "figure",
  "figcaption",
  "br",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "dl",
  "dt",
  "dd",
  "code",
  "pre",
] as const;

export function sanitizeCustomHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: [...CP_TAGS],
    allowedAttributes: {
      "*": ["class"],
      span: ["data-icon"],
      a: ["href", "target", "rel"],
      img: ["src", "alt", "title", "width", "height"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedClasses: { "*": [...CP_CLASSES] },
    allowedSchemes: ["https", "mailto"],
    allowProtocolRelative: false,
    // 站内相对路径（/assets/... 与锚点）允许；协议相对与 javascript: 已禁
    transformTags: {
      span: (tagName, attribs) => {
        const safe = { ...attribs };
        if (
          !attribs.class?.split(/\s+/).includes("cp-icon") ||
          !isCustomPageIconName(attribs["data-icon"] ?? "")
        ) {
          delete safe["data-icon"];
        }
        return { tagName, attribs: safe };
      },
      a: (tagName, attribs) => ({
        tagName,
        attribs:
          attribs.target === "_blank"
            ? { ...attribs, rel: "noopener noreferrer" }
            : attribs,
      }),
    },
  });
}

/** class 属性是否只含 cp-*（供 AI 生成结果与测试断言）。 */
export function hasOnlyCpClasses(html: string): boolean {
  const re = /class="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    for (const cls of m[1].trim().split(/\s+/)) {
      if (cls && !CP_SET.has(cls)) return false;
    }
  }
  return true;
}

/** slug 合法性（与 custom_pages 表约束一致）。 */
export function isValidPageSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,60}$/.test(slug);
}
