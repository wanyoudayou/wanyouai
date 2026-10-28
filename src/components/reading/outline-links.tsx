"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** 对服务端已渲染的目录做滚动高亮；不接收正文或标题字符串。 */
export function OutlineLinks({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const links = Array.from(root.current?.querySelectorAll<HTMLAnchorElement>('a[href^="#section-"]') ?? []);
    const update = () => {
      let current = links[0];
      for (const link of links) {
        const heading = document.getElementById(link.hash.slice(1));
        if (heading && heading.getBoundingClientRect().top <= 140) current = link;
      }
      for (const link of links) {
        if (link === current) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
      }
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("hashchange", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("hashchange", update); };
  }, [children]);
  return <div ref={root}>{children}</div>;
}
