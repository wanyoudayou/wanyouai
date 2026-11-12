import type { Metadata } from "next";
import { isRetiredTemplateImage } from "../retired-template-images";
/** Keep chapter identity, discard payment/tracking parameters and reject another origin. */
export function canonicalUrl(origin: string, path: string) {
  const base = new URL(origin);
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error("Invalid canonical origin");
  const chapter = /^\/(collections|handbooks|skills|events)\/[^/]+\/?$/.test(
    url.pathname,
  )
    ? url.searchParams.get("article")
    : null;
  url.search = "";
  url.hash = "";
  if (chapter && /^[a-z0-9][a-z0-9-]{0,119}$/.test(chapter))
    url.searchParams.set("article", chapter);
  return url.toString();
}
export function buildPublicMetadata(input: {
  origin: string;
  path: string;
  title: string;
  siteName: string;
  description: string;
  image?: string | null;
}): Metadata {
  const url = canonicalUrl(input.origin, input.path);
  let image: string | null = null;
  if (input.image) {
    try {
      const candidate = new URL(input.image, input.origin);
      const retired = candidate.origin === new URL(input.origin).origin &&
        isRetiredTemplateImage(candidate.pathname);
      if (["https:", "http:"].includes(candidate.protocol) && !retired)
        image = candidate.toString();
    } catch {
      /* An invalid optional cover leaves the sharing summary text-only. */
    }
  }
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      title: input.title,
      description: input.description,
      siteName: input.siteName,
      url,
      images: image ? [{ url: image }] : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: input.title,
      description: input.description,
      images: image ? [image] : [],
    },
  };
}
