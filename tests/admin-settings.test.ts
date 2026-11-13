import test from "node:test";
import assert from "node:assert/strict";
import { mergeIdentity, parseCardSettings, parseSiteSettings, BLOCKS } from "../src/lib/admin/settings-input";
import { parseService, PROTOCOL_FIELDS } from "../src/lib/admin/service-input";
import { normalizeHomeConfig, normalizeIdentityConfig } from "../src/types/site";
test("site settings: five blocks each once, refund page slug, commerce", () => {
  const form = new FormData();
  const fields = { tagline: "简介", site_name: "测试站", one_liner: "帮助读者", hero_action_chat: "on", amount: "99", currency: "CNY" };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); form.set(`block.${i}.enabled`, "on"); });
  assert.equal(parseSiteSettings(form).commerce.payment_enabled, false);
  form.set("block.0.type", "showcase"); assert.throws(() => parseSiteSettings(form)); form.set("block.0.type", BLOCKS[0]);
  form.set("refund_policy_page", "refund-policy"); assert.equal(parseSiteSettings(form).commerce.refund_policy_page, "refund-policy");
  form.set("refund_policy_page", "bad slug!"); assert.throws(() => parseSiteSettings(form), /退款政策页面/);
});

test("subscription can be unconfigured while other paid products remain available", () => {
  const form = new FormData();
  form.set("hero_action_chat", "on"); form.set("site_name", "测试站"); form.set("one_liner", "帮助读者");
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
  // zpay 只按人民币结算：开通在线收款时拒绝其他展示币种，关闭后可用于纯展示。
  form.set("currency", "USD");
  assert.throws(() => parseSiteSettings(form), /人民币/);
  form.delete("payment_enabled");
  assert.equal(parseSiteSettings(form).commerce.subscription_price?.currency, "USD");
});

test("card settings: contact anyOf, IANA timezone, booking page slug", () => {
  const form = new FormData();
  const fields = { site_name: "测试站", owner_name: "测试站主", one_liner: "帮助读者", languages: "zh-CN\nen", timezone: "Asia/Shanghai", working_hours: "工作日", response_time: "两天内", current_load: "可预约", email: "owner@example.test" };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const card = parseCardSettings(form);
  assert.equal("one_liner" in card.identity || "logo_url" in card.identity || "site_name" in card, false, "站名、Logo 与一句话归站点配置");
  assert.equal(card.owner_name, "测试站主");
  form.set("languages", "中文"); assert.throws(() => parseCardSettings(form), /服务语言.*zh-CN/); form.set("languages", "zh-CN\nen");
  form.set("one_liner", ""); assert.equal(parseCardSettings(form).owner_name, "测试站主"); form.set("one_liner", "帮助读者");
  form.set("owner_name", ""); assert.throws(() => parseCardSettings(form), /站主名称/); form.set("owner_name", "测试站主");
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
  const fields = { site_name: "测试站", owner_name: "测试站主", one_liner: "帮助读者", languages: "zh-CN", timezone: "Asia/Shanghai", working_hours: "工作日", response_time: "两天内", current_load: "可预约", email: "owner@example.test", hero_action_chat: "on", amount: "99", currency: "CNY" };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); });
  form.set("logo_url", "/assets/my-logo.png");
  form.set("avatar_url", "https://media.example.test/avatar.png");
  const parsed = parseCardSettings(form);
  assert.equal(parseSiteSettings(form).identity.logo_url, "/assets/my-logo.png");
  assert.equal(parsed.identity.avatar_url, "https://media.example.test/avatar.png");
  form.set("avatar_url", "http://insecure.example.test/a.png");
  assert.throws(() => parseCardSettings(form), /站主头像/);
  form.set("avatar_url", "javascript:alert(1)");
  assert.throws(() => parseCardSettings(form), /站主头像/);
  form.set("logo_url", "ftp://example.test/logo.png");
  assert.throws(() => parseSiteSettings(form), /站点 Logo/);
  form.set("logo_url", ""); form.set("avatar_url", "");
  assert.equal(parseSiteSettings(form).identity.logo_url, "");
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

test("hero settings: subtitle, layout, side image and at least one action", () => {
  const form = new FormData();
  form.set("site_name", "测试站"); form.set("one_liner", "帮助读者");
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); });
  assert.throws(() => parseSiteSettings(form), /至少勾选一个/);
  form.set("hero_action_subscribe", "on");
  form.set("hero_subtitle", "帮独立创作者把知识变成服务");
  form.set("hero_layout", "left");
  form.set("hero_image_url", "/assets/side.png");
  assert.throws(() => parseSiteSettings(form), /替代文字/);
  form.set("hero_image_alt", "工作台截图");
  form.set("hero_action_subscribe_label", "成为会员");
  const saved = parseSiteSettings(form).home_config.hero;
  assert.deepEqual(saved.actions, { subscribe: { enabled: true, label: "成为会员" }, chat: { enabled: false } });
  const hero = normalizeHomeConfig(parseSiteSettings(form).home_config).hero;
  assert.deepEqual(hero, { subtitle: "帮独立创作者把知识变成服务", layout: "left", imageUrl: "/assets/side.png", imageAlt: "工作台截图", actions: { subscribe: { enabled: true, label: "成为会员" }, chat: { enabled: false, label: null } } });
  form.set("hero_image_url", "http://insecure.example.test/a.png");
  assert.throws(() => parseSiteSettings(form), /首屏右侧图片/);
  form.set("hero_image_url", "/assets/side.png");
  form.set("hero_action_chat_label", "这是一段超过十六个字的按钮文字内容");
  assert.throws(() => parseSiteSettings(form), /首页配置/);
  form.set("hero_subtitle", "长".repeat(161));
  assert.throws(() => parseSiteSettings(form), /副标题/);
  // 旧配置：问句框位置改为「和我聊聊」，订阅默认开启，居中布局
  const legacy = normalizeHomeConfig({ hero: { ask_placeholder: "想了解什么？", enabled: true } }).hero;
  assert.deepEqual(legacy, { subtitle: null, layout: "center", imageUrl: null, imageAlt: null, actions: { subscribe: { enabled: true, label: null }, chat: { enabled: true, label: null } } });
  const none = normalizeHomeConfig({ hero: { actions: { subscribe: { enabled: false }, chat: { enabled: false } } } }).hero;
  assert.equal(none.actions.chat.enabled, true);
});

test("site settings own site name, logo, one-liner and the banner toggle; identity keys merge without overwriting", () => {
  const form = new FormData();
  BLOCKS.forEach((type, i) => { form.set(`block.${i}.type`, type); form.set(`block.${i}.title`, type); form.set(`block.${i}.limit`, "5"); });
  form.set("hero_action_chat", "on");
  assert.throws(() => parseSiteSettings(form), /站名/);
  form.set("site_name", "测试站");
  assert.throws(() => parseSiteSettings(form), /一句话介绍/);
  form.set("one_liner", "帮独立创作者\n把知识变成服务");
  form.set("tagline", "内容与服务");
  const site = parseSiteSettings(form);
  assert.equal(site.site_name, "测试站");
  assert.equal(site.tagline, "内容与服务");
  assert.deepEqual(site.identity, { one_liner: "帮独立创作者\n把知识变成服务", logo_url: "" });
  assert.equal(site.home_config.hero.banner_enabled, false);
  assert.equal("enabled" in site.home_config.hero, false);
  form.set("banner_enabled", "on");
  assert.equal(parseSiteSettings(form).home_config.hero.banner_enabled, true);
  form.set("one_liner", "长".repeat(181));
  assert.throws(() => parseSiteSettings(form), /一句话介绍/);
  const stored = { one_liner: "旧一句话", logo_url: "/old.png", languages: ["zh-CN"], timezone: "Asia/Shanghai", focus_areas: ["写作"], avatar_url: "/me.png" };
  assert.deepEqual(mergeIdentity(stored, site.identity), { ...stored, one_liner: "帮独立创作者\n把知识变成服务", logo_url: "" });
  assert.deepEqual(mergeIdentity(stored, { languages: ["en"], timezone: "UTC", focus_areas: [] }), { ...stored, languages: ["en"], timezone: "UTC", focus_areas: [] });
  assert.deepEqual(mergeIdentity(null, { one_liner: "x" }), { one_liner: "x" });
  // 旧的整块显隐读作横幅显隐，Hero 始终显示
  assert.equal(normalizeHomeConfig({ hero: { enabled: false } }).bannerEnabled, false);
  assert.equal(normalizeHomeConfig({ hero: { enabled: false, banner_enabled: true } }).bannerEnabled, true);
  assert.equal(normalizeHomeConfig({}).bannerEnabled, true);
});
