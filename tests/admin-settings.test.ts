import test from "node:test";
import assert from "node:assert/strict";
import { parseCardSettings, parseSiteSettings, BLOCKS } from "../src/lib/admin/settings-input";
import { parseService, PROTOCOL_FIELDS } from "../src/lib/admin/service-input";
import { normalizeHomeConfig, normalizeIdentityConfig } from "../src/types/site";
test("site settings: five blocks each once, refund page slug, commerce", () => {
  const form = new FormData();
  const fields = { tagline: "简介", ask_placeholder: "想了解什么", amount: "99", currency: "CNY" };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); form.set(`block.${i}.enabled`, "on"); });
  assert.equal(parseSiteSettings(form).commerce.payment_enabled, false);
  form.set("block.0.type", "showcase"); assert.throws(() => parseSiteSettings(form)); form.set("block.0.type", BLOCKS[0]);
  form.set("refund_policy_page", "refund-policy"); assert.equal(parseSiteSettings(form).commerce.refund_policy_page, "refund-policy");
  form.set("refund_policy_page", "bad slug!"); assert.throws(() => parseSiteSettings(form), /退款政策页面/);
});

test("subscription can be unconfigured while other paid products remain available", () => {
  const form = new FormData();
  form.set("ask_placeholder", "想了解什么");
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); });
  assert.equal(parseSiteSettings(form).commerce.subscription_price, null);
  form.set("payment_enabled", "on");
  assert.throws(() => parseSiteSettings(form), /支付渠道/);
  form.set("channel.alipay", "on");
  assert.equal(parseSiteSettings(form).commerce.subscription_price, null);
  for (const amount of ["0", "-1", "abc", "Infinity"]) {
    form.set("amount", amount);
    assert.throws(() => parseSiteSettings(form), /商业配置/);
  }
  form.set("amount", "99"); form.set("currency", "CNY");
  assert.equal(parseSiteSettings(form).commerce.subscription_price?.amount, 99);
});

test("card settings: contact anyOf, IANA timezone, booking page slug", () => {
  const form = new FormData();
  const fields = { site_name: "测试站", owner_name: "测试站主", one_liner: "帮助读者", languages: "zh-CN\nen", timezone: "Asia/Shanghai", working_hours: "工作日", response_time: "两天内", current_load: "可预约", email: "owner@example.test" };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  assert.equal(parseCardSettings(form).identity.one_liner, "帮助读者");
  form.set("languages", "中文"); assert.throws(() => parseCardSettings(form), /服务语言.*zh-CN/); form.set("languages", "zh-CN\nen");
  form.set("one_liner", ""); assert.throws(() => parseCardSettings(form), /一句话介绍/); form.set("one_liner", "帮助读者");
  form.set("timezone", "invalid/timezone"); assert.throws(() => parseCardSettings(form)); form.set("timezone", "Asia/Shanghai");
  // 预约页面 = 自定义页 slug 选择器：非法 slug 拒绝，合法 slug 与留空放行
  form.set("booking_page", "javascript:alert(1)"); assert.throws(() => parseCardSettings(form), /预约页面/);
  form.set("booking_page", "book-fde"); assert.equal(parseCardSettings(form).contact.booking_page, "book-fde");
  form.delete("email"); form.delete("booking_page"); assert.throws(() => parseCardSettings(form));
});
test("services require complete protocol before publication and reject state reversal", () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ slug: "test-service", title: "诊断", sort: "0", status: "published", price: "12.50", deliverables: "报告", duration: "3天" })) form.set(key, value);
  assert.throws(() => parseService(form, "draft"));
  for (const key of Object.keys(PROTOCOL_FIELDS)) form.set(key, "服务约定");
  assert.equal(parseService(form, "draft").price, 12.5);
  assert.throws(() => parseService(form, "archived"));
  form.set("status", "archived"); assert.throws(() => parseService(form, "paused")); form.set("archive_notice", "on"); assert.equal(parseService(form, "paused").status, "archived");
});

test("settings accept logo/avatar as https or site-relative path, reject other schemes", () => {
  const form = new FormData();
  const fields = { site_name: "测试站", owner_name: "测试站主", one_liner: "帮助读者", languages: "zh-CN", timezone: "Asia/Shanghai", working_hours: "工作日", response_time: "两天内", current_load: "可预约", email: "owner@example.test", ask_placeholder: "想了解什么", amount: "99", currency: "CNY" };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); });
  form.set("logo_url", "/assets/my-logo.png");
  form.set("avatar_url", "https://media.example.test/avatar.png");
  const parsed = parseCardSettings(form);
  assert.equal(parsed.identity.logo_url, "/assets/my-logo.png");
  assert.equal(parsed.identity.avatar_url, "https://media.example.test/avatar.png");
  form.set("avatar_url", "http://insecure.example.test/a.png");
  assert.throws(() => parseCardSettings(form), /站主头像/);
  form.set("avatar_url", "javascript:alert(1)");
  assert.throws(() => parseCardSettings(form), /站主头像/);
  form.set("logo_url", "ftp://example.test/logo.png");
  assert.throws(() => parseCardSettings(form), /站点 Logo/);
  form.set("logo_url", ""); form.set("avatar_url", "");
  assert.equal(parseCardSettings(form).identity.logo_url, "");
  // 横幅链接同样接受站内相对路径（/assets/ 约定）
  form.set("banner_light_url", "/assets/banner-light.jpg");
  form.set("banner_dark_url", "https://media.example.test/banner-dark.jpg");
  form.set("hero_tone", "dim");
  const hero = parseSiteSettings(form).home_config.hero;
  assert.equal(hero.banner_light_url, "/assets/banner-light.jpg");
  assert.equal(hero.banner_dark_url, "https://media.example.test/banner-dark.jpg");
  assert.equal("tone" in hero, false);
  assert.equal("banner_url" in hero, false);
  for (const key of ["banner_light_url", "banner_dark_url"]) {
    const valid = String(form.get(key));
    form.set(key, "http://insecure.example.test/b.jpg");
    assert.throws(() => parseSiteSettings(form), /横幅图片/);
    form.set(key, valid);
  }
  form.delete("banner_light_url"); form.delete("banner_dark_url");
  const cleared = normalizeHomeConfig(parseSiteSettings(form).home_config);
  assert.equal(cleared.bannerLightUrl, null);
  assert.equal(cleared.bannerDarkUrl, null);
});

test("theme banners preserve the legacy light image without reusing it for dark mode", () => {
  const legacy = normalizeHomeConfig({ hero: { banner_url: "/assets/old.jpg", tone: "dim" } });
  assert.equal(legacy.bannerLightUrl, "/assets/old.jpg");
  assert.equal(legacy.bannerDarkUrl, null);
  const dual = normalizeHomeConfig({ hero: { banner_url: "/assets/old.jpg", banner_light_url: "/assets/light.jpg", banner_dark_url: "/assets/dark.jpg" } });
  assert.equal(dual.bannerLightUrl, "/assets/light.jpg");
  assert.equal(dual.bannerDarkUrl, "/assets/dark.jpg");
  assert.equal(normalizeHomeConfig({ hero: { banner_url: "/assets/old.jpg", banner_light_url: "" } }).bannerLightUrl, null);
});

test("unconfigured and retired template images use theme artwork and name initials", () => {
  assert.equal(normalizeIdentityConfig({}).logoUrl, null);
  assert.equal(normalizeIdentityConfig({}).avatarUrl, null);
  const identity = normalizeIdentityConfig({
    logo_url: "/images/logo.jpg",
    avatar_url: "/images/avatar.jpg?old=1",
  });
  assert.equal(identity.logoUrl, null);
  assert.equal(identity.avatarUrl, null);
  for (const hero of [
    {},
    { banner_url: "/images/home-hero.jpg" },
    { banner_light_url: "/images/home-hero.jpg?old=1", banner_dark_url: "/images/home-hero.jpg" },
  ]) {
    const home = normalizeHomeConfig({ hero });
    assert.equal(home.bannerLightUrl, null);
    assert.equal(home.bannerDarkUrl, null);
  }
  const custom = normalizeIdentityConfig({
    logo_url: "https://media.example.test/images/logo.jpg",
    avatar_url: "/assets/my-avatar.jpg",
  });
  assert.equal(custom.logoUrl, "https://media.example.test/images/logo.jpg");
  assert.equal(custom.avatarUrl, "/assets/my-avatar.jpg");
});
