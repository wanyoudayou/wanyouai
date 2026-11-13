import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parseSiteSettings, BLOCKS } from "../src/lib/admin/settings-input";
import { normalizeCommerceConfig } from "../src/types/site";
import { monthlyEquivalent, subscriptionHintLine, SUBSCRIPTION_HINT_ICON_NAMES } from "../src/lib/subscription-hint";
import { SubscriptionHint, subscriptionHintIcon } from "../src/components/reading/subscription-hint";

function settingsForm() {
  const form = new FormData();
  form.set("hero_action_chat", "on");
  form.set("site_name", "测试站");
  form.set("one_liner", "帮助读者");
  form.set("amount", "99");
  form.set("currency", "CNY");
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); });
  return form;
}

test("subscription hint: empty fields save null, filled fields save icon and text", () => {
  const form = settingsForm();
  assert.equal(parseSiteSettings(form).commerce.subscription_hint, null);
  form.set("subscription_hint_icon", "coffee");
  assert.deepEqual(parseSiteSettings(form).commerce.subscription_hint, { icon: "coffee", text: "" });
  form.set("subscription_hint_text", "约每月一杯美式");
  assert.deepEqual(parseSiteSettings(form).commerce.subscription_hint, { icon: "coffee", text: "约每月一杯美式" });
  form.set("subscription_hint_icon", "");
  assert.deepEqual(parseSiteSettings(form).commerce.subscription_hint, { icon: "", text: "约每月一杯美式" });
});

test("subscription hint: unknown icons and overlong text are rejected", () => {
  const form = settingsForm();
  form.set("subscription_hint_icon", "beer");
  assert.throws(() => parseSiteSettings(form), /订阅提示/);
  form.set("subscription_hint_icon", "coffee");
  form.set("subscription_hint_text", "字".repeat(41));
  assert.throws(() => parseSiteSettings(form), /订阅提示/);
  form.set("subscription_hint_text", "字".repeat(40));
  assert.equal(parseSiteSettings(form).commerce.subscription_hint?.text.length, 40);
});

test("subscription hint: normalization drops invalid values and keeps the order price untouched", () => {
  assert.equal(normalizeCommerceConfig({}).subscriptionHint, null);
  assert.equal(normalizeCommerceConfig({ subscription_hint: { icon: "", text: "  " } }).subscriptionHint, null);
  assert.deepEqual(normalizeCommerceConfig({ subscription_hint: { icon: "beer", text: "一杯" } }).subscriptionHint, { icon: null, text: "一杯" });
  const commerce = normalizeCommerceConfig({ subscription_price: { amount: 99, currency: "CNY", model: "per_year" }, subscription_hint: { icon: "coffee", text: "约每月一杯美式" } });
  assert.deepEqual(commerce.subscriptionHint, { icon: "coffee", text: "约每月一杯美式" });
  assert.equal(commerce.subscriptionPrice?.amount, 99);
});

test("subscription hint: monthly equivalent and hint line", () => {
  assert.equal(monthlyEquivalent(99, "CNY"), 8.25);
  assert.equal(monthlyEquivalent(120, "CNY"), 10);
  assert.equal(monthlyEquivalent(100, "CNY"), 8.33);
  assert.equal(monthlyEquivalent(9800, "JPY"), 817);
  const price = { amount: 99, currency: "CNY" };
  assert.equal(subscriptionHintLine(price, null), null);
  assert.equal(subscriptionHintLine(null, { icon: "coffee", text: "一杯" }), null);
  assert.equal(subscriptionHintLine(price, { icon: "coffee", text: null }), "约 ¥8.25 / 月");
  assert.equal(subscriptionHintLine(price, { icon: null, text: "约每月一杯美式" }), "约 ¥8.25 / 月 · 约每月一杯美式");
  assert.equal(subscriptionHintLine({ amount: 120, currency: "CNY" }, { icon: null, text: "一杯" }), "约 ¥10 / 月 · 一杯");
});

test("subscription hint: icon is decorative and nothing renders without a price or hint", () => {
  const price = { amount: 99, currency: "CNY" };
  const hint = { icon: "coffee" as const, text: "约每月一杯美式" };
  const icon = renderToStaticMarkup(<>{subscriptionHintIcon({ subscriptionPrice: price, subscriptionHint: hint })}</>);
  assert.match(icon, /aria-hidden="true"/);
  assert.match(icon, /data-subscription-hint-icon="coffee"/);
  assert.equal(subscriptionHintIcon({ subscriptionPrice: null, subscriptionHint: hint }), null);
  assert.equal(subscriptionHintIcon({ subscriptionPrice: price, subscriptionHint: null }), null);
  assert.match(renderToStaticMarkup(<SubscriptionHint commerce={{ subscriptionPrice: price, subscriptionHint: hint }} />), /约 ¥8\.25 \/ 月 · 约每月一杯美式/);
  assert.equal(renderToStaticMarkup(<SubscriptionHint commerce={{ subscriptionPrice: price, subscriptionHint: null }} />), "");
});

test("subscription hint: schema icon enum matches the code whitelist", () => {
  const schema = JSON.parse(readFileSync(new URL("../docs/contracts/site-config.schema.json", import.meta.url), "utf8"));
  const enumValues = schema.properties.commerce.properties.subscription_hint.properties.icon.enum;
  assert.deepEqual(enumValues, ["", ...SUBSCRIPTION_HINT_ICON_NAMES]);
});
