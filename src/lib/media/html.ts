import type { MediaAsset } from "./types";
/** The normal custom-page sanitizer still runs on both save and display. */
export function assetImageHtml(asset: MediaAsset) {
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!,
    );
  return `<img src="${escape(asset.url)}" alt="${escape(asset.alt || asset.name)}" loading="lazy">`;
}
