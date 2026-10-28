import Ajv2020 from "ajv/dist/2020.js";
import { sanitizeCustomHtml } from "@/lib/custom-pages/sanitize";
import addFormats from "ajv-formats";
import schema from "../../../docs/contracts/site-config.schema.json";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

/**
 * 站点配置双解析器（名片与站点分别保存）：
 * - parseCardSettings：名片基础 + identity + contact（保存只写 site_name/owner_name/identity/contact 四列）；
 * - parseSiteSettings：首页与商业配置（保存只写 tagline/footer_credit/home_config/commerce）。
 * 两个表单按列域更新，互不覆盖。
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
  if (url.startsWith("/")) return;
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
  return ajv.compile({ $schema: schema.$schema, $defs: schema.$defs, ...sub });
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
    if (!url || (!/^https:\/\//.test(url) && !url.startsWith("/")))
      throw new Error("平台链接需为 https 地址或站内 / 路径。");
    rows.push({ platform, label, url, ...(note ? { note } : {}) });
  }
  return rows;
}

/** 名片 tab：站名 / 站主 / identity / contact / 工作约束——完整拥有 identity 与 contact 两列（与站点配置零交叉，独立数据单元）。 */
export function parseCardSettings(form: FormData) {
  const identity = {
    one_liner: value(form, "one_liner"),
    languages: list(form, "languages"),
    timezone: value(form, "timezone"),
    focus_areas: list(form, "focus_areas"),
    logo_url: value(form, "logo_url"),
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
  const validateIdentity = compileSub("identity");
  if (!validateIdentity(identity)) {
    const field = validateIdentity.errors?.[0]?.instancePath.split("/")[1];
    const hints: Record<string, string> = {
      one_liner: "一句话介绍不能为空，最多 180 字。",
      languages: "服务语言请每行填写语言代码，例如 zh-CN 或 en，最多 4 项。",
      timezone: "时区请填写 IANA 标识，例如 Asia/Shanghai。",
      focus_areas: "专注领域最多 12 项，每项不超过 40 字。",
      logo_url: "站点 Logo 地址过长，请检查链接。",
      avatar_url: "站主头像地址过长，请检查链接。",
      social_links: "平台露出信息格式无效，请检查显示名和链接。",
      custom_zone: "名片自定义区内容过长或格式无效。",
    };
    throw new Error(
      hints[field ?? ""] ??
        "名片配置不完整或格式无效，请检查一句话、语言、时区与平台露出。",
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
  checkUrl(form, "logo_url", "站点 Logo");
  checkUrl(form, "avatar_url", "站主头像");
  if (
    !value(form, "site_name") ||
    !value(form, "owner_name") ||
    value(form, "site_name").length > 120 ||
    value(form, "owner_name").length > 120
  )
    throw new Error("请检查站名与站主名称长度（120 字以内）。");
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
    site_name: value(form, "site_name"),
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
      ask_placeholder: value(form, "ask_placeholder"),
      enabled: form.has("hero_enabled"),
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
  const validateHome = compileSub("home_config");
  if (!validateHome(home_config))
    throw new Error("首页配置不完整或格式无效，请检查五块与事实徽章。");

  const payment_channels = (["alipay", "wxpay"] as const).filter((channel) =>
    form.has(`channel.${channel}`),
  );
  if (form.has("payment_enabled") && payment_channels.length === 0)
    throw new Error("开通在线收款至少需要选择一个支付渠道。");
  const amount = value(form, "amount");
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
  };
  checkSlug(value(form, "refund_policy_page"), "退款政策页面");
  checkSlug(value(form, "subscribe_page"), "订阅链接页面");
  const validateCommerce = compileSub("commerce");
  if (!validateCommerce(commerce))
    throw new Error("商业配置不完整或格式无效，请检查订阅价格与退款政策页面。");

  checkUrl(form, "banner_light_url", "浅色横幅图片");
  checkUrl(form, "banner_dark_url", "深色横幅图片");
  if (value(form, "tagline").length > 300)
    throw new Error("站点简介不超过 300 字。");
  return {
    tagline: value(form, "tagline") || null,
    footer_credit: form.has("footer_credit"),
    home_config,
    commerce,
  };
}
