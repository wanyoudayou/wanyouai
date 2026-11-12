/** Static names only; generated HTML cannot select arbitrary components. */
export const CP_ICON_NAMES = [
  "book-open",
  "shield-check",
  "cloud-upload",
  "bot",
  "check",
  "arrow-right",
  "mail",
  "calendar",
  "layers",
  "credit-card",
] as const;

export type CustomPageIconName = (typeof CP_ICON_NAMES)[number];

export function isCustomPageIconName(
  value: string,
): value is CustomPageIconName {
  return (CP_ICON_NAMES as readonly string[]).includes(value);
}
