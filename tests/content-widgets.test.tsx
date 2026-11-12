import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { renderWidgetHtml } from "../src/lib/custom-pages/widgets";

test("widgets preserve nested HTML and include prices in the server output", () => {
  const html = renderToStaticMarkup(
    renderWidgetHtml(
      '<section class="cp-grid-2"><div class="cp-card"><h2>Plan</h2><div class="cp-pricing"></div></div><p>After</p></section>',
      { pricing: <strong>当前真实价格</strong>, subscribe: <span>订阅</span> },
    ),
  );
  assert.match(html, /<h2>Plan<\/h2><section id="pricing"/);
  assert.match(html, /当前真实价格/);
  assert.match(html, /<p>After<\/p><\/section>$/);
});
test("widgets retain sanitization and allocate a single pricing anchor", () => {
  const html = renderToStaticMarkup(
    renderWidgetHtml(
      '<div class="cp-pricing" onclick="evil()"></div><div class="cp-subscribe"></div><script>evil()</script><img src="javascript:evil()">',
      { pricing: <b>Pricing</b>, subscribe: <i>Subscribe</i> },
    ),
  );
  assert.equal((html.match(/id="pricing"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /onclick|script|javascript:|evil/);
});
