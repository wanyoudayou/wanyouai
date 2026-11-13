import Ajv2020 from "ajv/dist/2020.js";
import { sanitizeCustomHtml } from "@/lib/custom-pages/sanitize";
import { PAYMENT_CURRENCY } from "@/lib/format";
import { HERO_SUBTITLE_MAX, ONE_LINER_MAX } from "@/types/site";
import addFormats from "ajv-formats";
import schema from "../../../docs/contracts/site-config.schema.json";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

/**
 * 站点配置双解析器（名片与站点分别保存）：
 * - parseCardSettings：站主 + identity 中名片字段 + contact + constraints；
 * - parseSiteSettings：站名、Logo 与小标题、一句话、首页与商业配置。
 * identity 由两页分键拥有：一句话与 Logo 归站点配置（SITE_IDENTITY_KEYS），其余归名片；
 * 保存时按版本读出当前 identity 合并本页字段（mergeIdentity），两页互不覆盖。
 */

const value = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
const list = (form: FormData, name: string) =>
  value(form, name)
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);

function checkUrl(form: FormData, name: string, label: string) {
  const url = value(form, name);
  if (!url) return;
  if (/^\/(?![\/\\])/.test(url)) return;
  try {
    if (new URL(url).protocol === "https:") return;
  } catch {
    /* 落到统一报错 */
  }
  throw new Error(
    `${label}请填写 https 图片地址，或站内以 / 开头的路径（如 /assets/logo.png）。`,
  );
}

function checkSlug(slug: string, label: string) {
  if (slug && !/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug))
    throw new Error(`${label}选择无效，请刷新后重试。`);
}

// Ajv 按对象身份缓存已编译的 schema；每次保存都新建 schema 会让缓存不断增长，这里按 key 只编译一次。
const compiledSubs = new Map<string, ReturnType<typeof ajv.compile>>();
function compileSub(
  key:
    | "identity"
    | "contact"
    | "constraints"
    | "home_config"
    | "commerce"
    | "avatar_config",
) {
  const sub =
    key === "home_config"
      ? { $defs: schema.$defs, $ref: "#/$defs/home_config" }
      : schema.properties[key as keyof typeof schema.properties];
  const cached = compiledSubs.get(key);
  if (cached) return cached;
  const compiled = ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, ...sub });
  compiledSubs.set(key, compiled);
  return compiled;
}

const SOCIAL_KEYS = [
  "x",
  "github",
  "xiaohongshu",
  "xiaoyuzhou",
  "wechat-official",
  "custom",
];
function parseSocialLinks(form: FormData) {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const platform = value(form, `social.${i}.platform`);
    const label = value(form, `social.${i}.label`);
    const url = value(form, `social.${i}.url`);
    const note = value(form, `social.${i}.note`);
    if (!platform && !label && !url) continue;
    if (!SOCIAL_KEYS.includes(platform))
      throw new Error("自媒体平台类型无效，请刷新后重试。");
    if (!label || label.length > 40)
      throw new Error("每条平台露出需填写 40 字以内的显示名。");
    if (!url || (!/^https:\/\//.test(url) && !/^\/(?![\/\\])/.test(url)))
      throw new Error("平台链接需为 https 地址或站内 / 路径。");
    rows.push({ platform, label, url, ...(note ? { note } : {}) });
  }
  return rows;
}

/** identity 中由站点配置页保存的键；其余键由名片页保存。 */
export const SITE_IDENTITY_KEYS = ["one_liner", "logo_url"] as const;


/** 合并本页拥有的 identity 键；其余键保留数据库当前值。 */
export function mergeIdentity(current: unknown, patch: Record<string, unknown>) {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
  return { ...base, ...patch };
}

let cardIdentityValidator: ReturnType<typeof ajv.compile> | null = null;
function validateCardIdentity() {
  if (!cardIdentityValidator) {
    const full = schema.properties.identity;
    cardIdentityValidator = ajv.compile({
      $schema: schema.$schema, $defs: schema.$defs, ...full,
      required: full.required.filter((key) => !(SITE_IDENTITY_KEYS as readonly string[]).includes(key)),
    });
  }
  return cardIdentityValidator;
}

/** 名片 tab：站主 / identity 名片字段 / contact / 工作约束。站名、Logo 与一句话在站点配置。 */
export function parseCardSettings(form: FormData) {
  const identity = {
    languages: list(form, "languages"),
    timezone: value(form, "timezone"),
    focus_areas: list(form, "focus_areas"),
    avatar_url: value(form, "avatar_url"),
    social_links: parseSocialLinks(form),
    custom_zone: {
      enabled: form.has("card_zone_enabled"),
      html: sanitizeCustomHtml(value(form, "card_zone_html")),
    },
    show_subscription_card: form.has("show_subscription_card"),
  };
  const contact = {
    ...(value(form, "email") && { email: value(form, "email") }),
    ...(value(form, "booking_page") && {
      booking_page: value(form, "booking_page"),
    }),
  };
  checkSlug(value(form, "booking_page"), "预约页面");
  const validateIdentity = validateCardIdentity();
  if (!validateIdentity(identity)) {
    const field = validateIdentity.errors?.[0]?.instancePath.split("/")[1];
    const hints: Record<string, string> = {
      languages: "服务语言请每行填写语言代码，例如 zh-CN 或 en，最多 4 项。",
      timezone: "时区请填写 IANA 标识，例如 Asia/Shanghai。",
      focus_areas: "专注领域最多 12 项，每项不超过 40 字。",
      avatar_url: "站主头像地址过长，请检查链接。",
      social_links: "平台露出信息格式无效，请检查显示名和链接。",
      custom_zone: "名片自定义区内容过长或格式无效。",
    };
    throw new Error(
      hints[field ?? ""] ??
        "名片配置不完整或格式无效，请检查语言、时区与平台露出。",
    );
  }
  const validateContact = compileSub("contact");
  if (!validateContact(contact))
    throw new Error("联系与预约至少填写一项（联系邮箱或预约页面）。");
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: identity.timezone });
  } catch {
    throw new Error("请输入有效 IANA 时区，例如 Asia/Shanghai。");
  }
  checkUrl(form, "avatar_url", "站主头像");
  if (!value(form, "owner_name") || value(form, "owner_name").length > 120)
    throw new Error("请填写站主名称（120 字以内）。");
  const constraints = {
    working_hours: value(form, "working_hours"),
    response_time: value(form, "response_time"),
    current_load: value(form, "current_load"),
    exclusions: list(form, "exclusions"),
  };
  const validateConstraints = compileSub("constraints");
  if (!validateConstraints(constraints))
    throw new Error("工作约束字段格式无效（工作时间 / 响应时间 / 容量必填）。");
  return {
    owner_name: value(form, "owner_name"),
    identity,
    contact,
    constraints,
  };
}

export const BLOCKS = [
  "blog",
  "handbook",
  "skill",
  "event",
  "service",
] as const;
export const FACTS = [
  "series_count",
  "article_count",
  "subscription_price",
  "service_capacity",
] as const;

/** 站点配置 tab：站点简介 / 首页 / 收款 / 分身。 */
export function parseSiteSettings(form: FormData) {
  const home_config = {
    hero: {
      banner_enabled: form.has("banner_enabled"),
      ...(value(form, "hero_subtitle") && { subtitle: value(form, "hero_subtitle") }),
      layout: value(form, "hero_layout") === "left" ? "left" : "center",
      ...(value(form, "hero_image_url") && {
        image_url: value(form, "hero_image_url"),
        ...(value(form, "hero_image_alt") && { image_alt: value(form, "hero_image_alt") }),
      }),
      actions: {
        subscribe: {
          enabled: form.has("hero_action_subscribe"),
          ...(value(form, "hero_action_subscribe_label") && { label: value(form, "hero_action_subscribe_label") }),
        },
        chat: {
          enabled: form.has("hero_action_chat"),
          ...(value(form, "hero_action_chat_label") && { label: value(form, "hero_action_chat_label") }),
        },
      },
      ...(value(form, "banner_light_url") && {
        banner_light_url: value(form, "banner_light_url"),
      }),
      ...(value(form, "banner_dark_url") && {
        banner_dark_url: value(form, "banner_dark_url"),
      }),
    },
    custom_zone: {
      enabled: form.has("custom_zone_enabled"),
      html: sanitizeCustomHtml(value(form, "custom_zone_html")),
    },
    blocks: BLOCKS.map((_, i) => ({
      type: value(form, `block.${i}.type`),
      enabled: form.has(`block.${i}.enabled`),
      title: value(form, `block.${i}.title`),
      ...(value(form, `block.${i}.empty_text`) && {
        empty_text: value(form, `block.${i}.empty_text`),
      }),
      ...(value(form, `block.${i}.cta_label`) && {
        cta_label: value(form, `block.${i}.cta_label`),
      }),
      limit: Number(value(form, `block.${i}.limit`)),
    })),
    fact_badges: FACTS.filter((type) => form.has(`fact.${type}`)).map(
      (type) => ({
        type,
        ...(value(form, `fact.${type}.label`) && {
          label: value(form, `fact.${type}.label`),
        }),
      }),
    ),
  };
  if (
    new Set(home_config.blocks.map((block) => block.type)).size !== 5 ||
    home_config.blocks.some(
      (block) => !BLOCKS.includes(block.type as (typeof BLOCKS)[number]),
    )
  )
    throw new Error(
      "首页五个内容区块（博客/手册/技能/活动/服务）必须各出现一次。",
    );
  if (!form.has("hero_action_subscribe") && !form.has("hero_action_chat"))
    throw new Error("首屏按钮至少勾选一个：订阅或和我聊聊。");
  if (value(form, "hero_image_url") && !value(form, "hero_image_alt"))
    throw new Error("请为首屏右侧图片填写替代文字。");
  if (value(form, "hero_subtitle").length > HERO_SUBTITLE_MAX)
    throw new Error(`首屏副标题不超过 ${HERO_SUBTITLE_MAX} 字。`);
  const validateHome = compileSub("home_config");
  if (!validateHome(home_config))
    throw new Error("首页配置不完整或格式无效，请检查首屏按钮文字（不超过 16 字）、图片替代文字、五块与事实徽章。");

  const payment_channels = (["alipay", "wxpay"] as const).filter((channel) =>
    form.has(`channel.${channel}`),
  );
  if (form.has("payment_enabled") && payment_channels.length === 0)
    throw new Error("开通在线收款至少需要选择一个支付渠道。");
  const amount = value(form, "amount");
  if (
    form.has("payment_enabled") &&
    (value(form, "currency") || PAYMENT_CURRENCY) !== PAYMENT_CURRENCY
  )
    throw new Error("在线收款按人民币结算；开通在线收款时币种需为人民币 CNY。");
  const commerce = {
    payment_enabled: form.has("payment_enabled"),
    payment_channels,
    subscription_price: amount
      ? {
          amount: Number(amount),
          currency: value(form, "currency"),
          model: "per_year",
        }
      : null,
    refund_policy_page: value(form, "refund_policy_page"),
    subscribe_page: value(form, "subscribe_page"),
    subscription_hint:
      value(form, "subscription_hint_icon") || value(form, "subscription_hint_text")
        ? {
            icon: value(form, "subscription_hint_icon"),
            text: value(form, "subscription_hint_text"),
          }
        : null,
  };
  checkSlug(value(form, "refund_policy_page"), "退款政策页面");
  checkSlug(value(form, "subscribe_page"), "订阅链接页面");
  const validateCommerce = compileSub("commerce");
  if (!validateCommerce(commerce))
    throw new Error("商业配置不完整或格式无效，请检查订阅价格、订阅提示（不超过 40 字）与退款政策页面。");

  checkUrl(form, "logo_url", "站点 Logo");
  if (!value(form, "site_name") || value(form, "site_name").length > 120)
    throw new Error("请填写站名（120 字以内）。");
  const oneLiner = String(form.get("one_liner") ?? "").trim();
  if (!oneLiner || oneLiner.length > ONE_LINER_MAX)
    throw new Error(`一句话介绍不能为空，最多 ${ONE_LINER_MAX} 字。`);
  if (value(form, "logo_url").length > 2048)
    throw new Error("站点 Logo 地址过长，请检查链接。");
  checkUrl(form, "banner_light_url", "浅色横幅图片");
  checkUrl(form, "banner_dark_url", "深色横幅图片");
  checkUrl(form, "hero_image_url", "首屏右侧图片");
  if (value(form, "tagline").length > 300)
    throw new Error("LOGO 小标题不超过 300 字。");
  return {
    site_name: value(form, "site_name"),
    identity: { one_liner: oneLiner, logo_url: value(form, "logo_url") },
    tagline: value(form, "tagline") || null,
    footer_credit: form.has("footer_credit"),
    home_config,
    commerce,
  };
}
