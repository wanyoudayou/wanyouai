/** 侧栏激活：内置与自定义导航一起按路径段做最长前缀匹配，同一时刻只激活一项。 */
export function matchesPath(pathname: string, href: string): boolean {
  if (!href.startsWith("/")) return false;
  if (href === "/") return pathname === "/";
  const base = href.replace(/\/+$/, "");
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function activeHref(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (!matchesPath(pathname, href)) continue;
    if (best === null || href.length > best.length) best = href;
  }
  return best;
}
