import { contentJsonLd, safeJsonLd, type ContentOffer } from "@/lib/reading/json-ld";

export function ContentJsonLd({ offer }: { offer: ContentOffer }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(contentJsonLd(offer)) }} />;
}
