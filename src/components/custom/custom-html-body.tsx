import { renderWidgetHtml } from "@/lib/custom-pages/widgets";

/**
 * 自定义页正文（/p/[slug] 与首页自定义区共用）：
 * 渲染时再净化一次（防御纵深），样式能力全部来自 cp-* 语义类。
 */
export function CustomHtmlBody({ html }: { html: string }) {
  return <div className="custom-html-body">{renderWidgetHtml(html)}</div>;
}
