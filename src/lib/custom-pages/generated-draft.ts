import { parseDocument } from "htmlparser2";
import type { CustomPageContext } from "./design-contract";
import { sanitizeCustomHtml } from "./sanitize";

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];

/** Basic structure checks apply to generated drafts, not hand-authored saved pages. */
export function prepareGeneratedPageDraft(
  content: string,
  context: CustomPageContext,
): { html: string; issues: string[] } {
  const html = sanitizeCustomHtml(
    content
      .trim()
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim(),
  );
  const headings: number[] = [];
  const issues = new Set<string>();
  let pricing = 0;
  let subscribe = 0;
  let meaningful = false;

  function visit(node: HtmlNode, narrow = false) {
    if (node.type === "text") {
      meaningful ||= Boolean(node.data.trim());
      return;
    }
    if (!("name" in node) || !("attribs" in node)) return;
    const classes = (node.attribs.class ?? "").split(/\s+/);
    if (/^h[1-6]$/.test(node.name)) headings.push(Number(node.name[1]));
    if (node.name === "img" && node.attribs.src) {
      meaningful = true;
      if (!("alt" in node.attribs))
        issues.add("图片需要提供替代文字 alt；纯装饰图片可使用空 alt。");
    }
    const widget =
      classes.includes("cp-pricing") || classes.includes("cp-subscribe");
    if (widget) {
      if (node.name !== "div")
        issues.add("实时方案和订阅入口必须使用空的 div 占位。");
      if (classes.includes("cp-pricing")) pricing += 1;
      if (classes.includes("cp-subscribe")) subscribe += 1;
      meaningful = true;
      if (
        narrow ||
        classes.includes("cp-card") ||
        classes.includes("cp-inverse")
      ) {
        issues.add("实时方案不能放入内容卡片或反白区域，请作为独立段落展示。");
      }
      if (
        "children" in node &&
        node.children.some(
          (child) => child.type !== "text" || child.data.trim(),
        )
      ) {
        issues.add("实时方案占位需要保持为空，不在 HTML 中填写方案或价格。");
      }
    }
    if ("children" in node) {
      const nested =
        narrow || classes.includes("cp-card") || classes.includes("cp-inverse");
      for (const child of node.children) visit(child, nested);
    }
  }
  for (const node of parseDocument(html).children) visit(node);
  if (!meaningful) issues.add("没有可用的页面内容。");
  const h1Count = headings.filter((level) => level === 1).length;
  if (context === "page" && (h1Count !== 1 || headings[0] !== 1)) {
    issues.add("独立页需要从一个主标题 h1 开始。");
  }
  if (context !== "page" && h1Count > 0) {
    issues.add("嵌入区块应从 h2 开始，不能重复页面主标题。");
  }
  for (let i = 1; i < headings.length; i += 1) {
    if (headings[i] > headings[i - 1] + 1) {
      issues.add("标题层级不能跳级，请按 h1、h2、h3 顺序组织内容。");
    }
  }
  if (context !== "page" && headings.length && headings[0] !== 2) {
    issues.add("嵌入区块的首个标题需要使用 h2。");
  }
  if (pricing > 1 || subscribe > 1 || (pricing && subscribe)) {
    issues.add("同一页只保留一个实时方案区或一个订阅入口，避免重复购买动作。");
  }
  if (context === "card" && (pricing || subscribe)) {
    issues.add("名片右列应使用紧凑介绍，不放入完整收费方案或订阅组件。");
  }
  return { html, issues: [...issues] };
}
