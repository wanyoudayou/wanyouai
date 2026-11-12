import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  filterStalePageRef,
  normalizeAvatarConfig,
  normalizeCommerceConfig,
  normalizeConstraintsConfig,
  normalizeContactConfig,
  normalizeHomeConfig,
  normalizeIdentityConfig,
  type AvatarConfig,
  type CommerceConfig,
  type ConstraintsConfig,
  type ContactConfig,
  type HomeConfig,
  type IdentityConfig,
} from "@/types/site";

export interface SiteContext {
  siteName: string;
  tagline: string | null;
  ownerName: string;
  footerCredit: boolean;
  home: HomeConfig;
  identity: IdentityConfig;
  constraints: ConstraintsConfig;
  contact: ContactConfig;
  commerce: CommerceConfig;
  avatar: AvatarConfig;
}

const FALLBACK: SiteContext = {
  siteName: "万有AI",
  tagline: "一人公司的内容、服务与活动工作区",
  ownerName: "站主",
  footerCredit: true,
  home: normalizeHomeConfig({}),
  identity: normalizeIdentityConfig({}),
  constraints: normalizeConstraintsConfig({}),
  contact: normalizeContactConfig({}),
  commerce: normalizeCommerceConfig({}),
  avatar: normalizeAvatarConfig({}),
};

/** Single source for site-wide configuration. Degrades to defaults on any failure. */
export async function getSiteConfig(strict = false): Promise<SiteContext> {
  const supabase = await createSupabaseServerClient();
  const FIELDS = "site_name, tagline, owner_name, footer_credit, avatar_config, home_config, constraints, identity, contact, commerce";
  try {
    let { data, error } = await supabase
      .from("site_config")
      .select(FIELDS)
      .eq("id", 1)
      .maybeSingle();

    // 会话令牌被服务端拒绝（如 JWT iat 校验失败）时，公开配置按匿名身份重试——
    // 坏 cookie 不应让整站退回默认配置。
    if (error && /jwt|token/i.test(error.message)) {
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      ({ data, error } = await anon.from("site_config").select(FIELDS).eq("id", 1).maybeSingle());
    }

    if (error || !data) {
      if (strict) throw new Error("站点配置暂时不可用");
      if (error) console.error("[getSiteConfig]", error.message);
      return FALLBACK;
    }

    // 页面选择器死引用防护：booking_page / refund_policy_page 指向的
    // 自定义页被删除或下架时按未配置降级——链接消失（回退邮箱/纯文本），不出 404 死链。
    const refs = [data.contact?.booking_page, data.commerce?.refund_policy_page, data.commerce?.subscribe_page].filter(
      (slug): slug is string => typeof slug === "string" && slug.length > 0,
    );
    const published = new Set<string>();
    if (refs.length > 0) {
      const { data: refPages } = await supabase
        .from("custom_pages")
        .select("slug")
        .in("slug", refs)
        .eq("status", "published");
      for (const page of refPages ?? []) published.add(page.slug as string);
    }

    return {
      siteName: data.site_name || FALLBACK.siteName,
      tagline: data.tagline ?? null,
      ownerName: data.owner_name || FALLBACK.ownerName,
      footerCredit: data.footer_credit !== false,
      home: normalizeHomeConfig(data.home_config),
      identity: normalizeIdentityConfig(data.identity),
      constraints: normalizeConstraintsConfig(data.constraints),
      contact: normalizeContactConfig(filterStalePageRef(data.contact, "booking_page", published)),
      commerce: normalizeCommerceConfig(filterStalePageRef(filterStalePageRef(data.commerce, "refund_policy_page", published), "subscribe_page", published)),
      avatar: normalizeAvatarConfig(data.avatar_config),
    };
  } catch (error) {
    if (strict) throw new Error("站点配置暂时不可用");
    console.error("[getSiteConfig]", error);
    return FALLBACK;
  }
}
