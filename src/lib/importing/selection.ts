/** Browser folder selection includes the chosen outer directory. Only root notes are imported. */
export function rootMarkdownPath(path: string): string | null {
  const relative = path.includes("/")
    ? path.slice(path.indexOf("/") + 1)
    : path;
  return !relative.includes("/") &&
    !relative.startsWith(".") &&
    /\.(md|markdown)$/i.test(relative)
    ? relative
    : null;
}

/** Stable across retries; existing file bindings always take precedence. */
export function chapterSlug(
  series: string,
  path: string,
  suffix: string,
): string {
  return `${series.slice(0, 90).replace(/-+$/, "")}-${/^readme\.(md|markdown)$/i.test(path) ? "readme" : suffix.slice(0, 24)}`;
}
