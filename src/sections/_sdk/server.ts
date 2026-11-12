import "server-only";
import { getSiteConfig } from "@/lib/get-site-config";

/** 站点公开信息（服务端栏目组件使用）。 */
export async function getPublicSite() {
  const site = await getSiteConfig();
  return { siteName: site.siteName, tagline: site.tagline };
}
