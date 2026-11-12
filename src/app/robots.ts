import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site-url";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const origin = getSiteUrl();
  if (!origin) throw new Error("站点地址未配置");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api/",
        // 用 "/me/" 与 "/me$"：单写 "/me" 会按前缀连带屏蔽 /media 下的公开图片。
        "/me$",
        "/me/",
        "/checkout",
        "/login",
        "/auth/",
        "/checkin/",
      ],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
