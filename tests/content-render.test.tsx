import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/components/reading/markdown-content";
import { getOutline, safeImageSource } from "../src/lib/reading/markdown";
import { renderDiagram } from "../src/lib/reading/diagram";
import { contentJsonLd, safeJsonLd } from "../src/lib/reading/json-ld";

test("Markdown 支持列表/表格，HTML 与危险链接不执行，代码内 paywall 保留", () => {
  const markdown = '# 标题\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))\n\n- 项目\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```html\n<!-- paywall -->\n```\n\n<!-- paywall -->';
  const html = renderToStaticMarkup(<MarkdownContent markdown={markdown} />);
  assert(!html.includes('<script>')); assert(!html.includes('href="javascript:'));
  assert(html.includes('<table>')); assert(html.includes('<ul>'));
  assert(html.includes('&lt;!-- paywall --&gt;'));
  assert.equal(getOutline(markdown)[0].id, 'section-1');
  assert(html.includes('id="section-1"'));
});

test("标题锚点稳定且不解析代码块中的伪标题", () => {
  const markdown = '# A\n\n# A\n\n```md\n# hidden\n```';
  assert.deepEqual(getOutline(markdown).map((h) => h.id), ['section-1','section-2']);
});

test("图片只允许安全 HTTPS / 本站路径，不执行内联 SVG 或代理外部资源", () => {
  for (const src of ['javascript:alert(1)', 'data:image/svg+xml,x', '//evil.test/x', '/\\evil/x', 'https://evil/a.svg', 'https://u:p@evil/x']) assert.equal(safeImageSource(src), null);
  assert.equal(safeImageSource('/image.png'), '/image.png');
  assert.equal(safeImageSource('https://example.com/image.png'), 'https://example.com/image.png');
  const html = renderToStaticMarkup(<MarkdownContent markdown={'![公开图|320x180](https://example.com/image.png)'} />);
  assert.match(html, /<img\s/);
  assert.match(html, /src="https:\/\/example\.com\/image\.png"/);
  assert.match(html, /alt="公开图"/);
  assert.match(html, /width="320" height="180"/);
});

test("Mermaid 在服务端生成静态 SVG，去除脚本、样式与外链", () => {
  const svg = renderDiagram('graph TD\n  A[开始] --> B[结束]');
  assert(svg.includes('<svg')); assert(svg.includes('开始')); assert(svg.includes('结束'));
  assert(!svg.includes('<style')); assert(!svg.includes('fonts.googleapis.com'));
  assert(!svg.includes('<script')); assert(!svg.includes('href='));
  assert.throws(() => renderDiagram('x'.repeat(20001)));
});

test("JSON-LD 价格、停售状态与页面同源，阻断 script 闭合注入", () => {
  const value = contentJsonLd({ name: '</script><script>alert(1)</script>', description: null, url: '', skill: true, price: 49, currency: 'CNY', unavailable: true });
  assert.equal(value.offers?.price, 49); assert.equal(value.offers?.availability, 'https://schema.org/SoldOut');
  const serialized = safeJsonLd(value); assert(!serialized.includes('</script>')); assert.deepEqual(JSON.parse(serialized), value);
});
