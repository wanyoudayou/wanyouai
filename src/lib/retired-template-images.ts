const RETIRED_TEMPLATE_IMAGES = new Set([
  "/images/home-hero.jpg",
  "/images/avatar.jpg",
  "/images/logo.jpg",
]);

/** Removed template assets use the normal empty-image fallback on older sites. */
export function isRetiredTemplateImage(path: string): boolean {
  return RETIRED_TEMPLATE_IMAGES.has(path.split(/[?#]/, 1)[0]);
}
