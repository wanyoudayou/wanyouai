import "server-only";
import { getSiteConfig } from "@/lib/get-site-config";
import { getSiteUrl } from "@/lib/site-url";
import { buildPublicMetadata } from "./metadata";
export async function publicMetadata(
  title: string,
  path: string,
  description?: string | null,
  image?: string | null,
) {
  const site = await getSiteConfig();
  const origin = getSiteUrl();
  if (!origin) throw new Error("站点地址未配置");
  return buildPublicMetadata({
    origin,
    path,
    title,
    siteName: site.siteName,
    description: description ?? site.tagline ?? site.identity.oneLiner,
    image: image ?? site.home.bannerLightUrl ?? site.identity.logoUrl,
  });
}
