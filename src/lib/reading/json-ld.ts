export interface ContentOffer { name: string; description: string | null; url: string; skill: boolean; price: number | null; currency: string; unavailable: boolean }
export function contentJsonLd(offer: ContentOffer) {
  return {
    "@context": "https://schema.org",
    "@type": offer.skill ? "SoftwareApplication" : "Product",
    name: offer.name,
    ...(offer.description ? { description: offer.description } : {}),
    ...(offer.url ? { url: offer.url } : {}),
    ...(offer.price !== null ? { offers: { "@type": "Offer", price: Number(offer.price), priceCurrency: offer.currency, availability: offer.unavailable ? "https://schema.org/SoldOut" : "https://schema.org/InStock" } } : {}),
  };
}
export function safeJsonLd(value: unknown): string { return JSON.stringify(value).replace(/</g, "\\u003c"); }
