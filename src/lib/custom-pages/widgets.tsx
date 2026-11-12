import { createElement, type ReactNode } from "react";
import { parseDocument } from "htmlparser2";
import {
  ArrowRightIcon,
  BookOpenIcon,
  BotIcon,
  CalendarIcon,
  CheckIcon,
  CloudUploadIcon,
  CreditCardIcon,
  LayersIcon,
  MailIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { sanitizeCustomHtml } from "./sanitize";
import { isCustomPageIconName } from "./icon-names";

const ICONS = {
  "book-open": BookOpenIcon,
  "shield-check": ShieldCheckIcon,
  "cloud-upload": CloudUploadIcon,
  bot: BotIcon,
  check: CheckIcon,
  "arrow-right": ArrowRightIcon,
  mail: MailIcon,
  calendar: CalendarIcon,
  layers: LayersIcon,
  "credit-card": CreditCardIcon,
} as const;

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
/** Render the sanitized tree intact so nested widgets have real SSR content. */
export function renderWidgetHtml(
  html: string,
  widgets?: { pricing: ReactNode; subscribe: ReactNode },
): ReactNode {
  let anchored = false;
  function render(node: HtmlNode, key: string): ReactNode {
    if (node.type === "text") return node.data;
    if (!("name" in node) || !("attribs" in node)) return null;
    const classes = (node.attribs.class ?? "").split(/\s+/);
    const iconName = node.attribs["data-icon"] ?? "";
    if (
      node.name === "span" &&
      classes.includes("cp-icon") &&
      isCustomPageIconName(iconName)
    ) {
      return createElement(
        "span",
        { key, className: "cp-icon" },
        createElement(ICONS[iconName], {
          size: 20,
          strokeWidth: 1.8,
          "aria-hidden": true,
          focusable: false,
        }),
      );
    }
    const widget =
      node.name === "div" &&
      (classes.includes("cp-pricing")
        ? "pricing"
        : classes.includes("cp-subscribe")
          ? "subscribe"
          : null);
    if (widget && widgets) {
      const id = anchored ? undefined : "pricing";
      anchored = true;
      return (
        <section key={key} id={id} className="scroll-mt-6">
          {widgets[widget]}
        </section>
      );
    }
    const names: Record<string, string> = {
      class: "className",
      colspan: "colSpan",
      rowspan: "rowSpan",
    };
    const props = Object.fromEntries(
      Object.entries(node.attribs).map(([name, value]) => [
        names[name] ?? name,
        value,
      ]),
    );
    const children =
      "children" in node
        ? node.children.map((child, i) => render(child, `${key}.${i}`))
        : [];
    return node.name === "img" || node.name === "br" || node.name === "hr"
      ? createElement(node.name, { ...props, key })
      : createElement(node.name, { ...props, key }, ...children);
  }
  return parseDocument(sanitizeCustomHtml(html)).children.map((node, i) =>
    render(node, String(i)),
  );
}
