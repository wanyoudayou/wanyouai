"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Scroll-linked parallax for the home hero (页面契约 3.1 块 1).
 *
 * The hero stays in normal flow and scrolls away. While it leaves the viewport,
 * progress 0…1 and the distance travelled are written to CSS variables; hero.css
 * moves the backdrop and the optional side image more slowly than the page and
 * shrinks the image slightly. Before hydration and with reduced motion the hero
 * is static.
 */
export function HeroParallax({
  className,
  children,
  ...props
}: {
  className: string;
  children: ReactNode;
} & Omit<React.ComponentPropsWithoutRef<"section">, "className" | "children">) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const header = document.querySelector<HTMLElement>("[data-shell-header]");
    let frame = 0;
    const update = () => {
      frame = 0;
      const range = el.offsetHeight;
      const travelled = Math.min(Math.max((header?.offsetHeight ?? 0) - el.getBoundingClientRect().top, 0), range);
      el.style.setProperty("--opc-hero-shift", `${travelled}px`);
      el.style.setProperty("--opc-hero-p", range > 0 ? (travelled / range).toFixed(4) : "0");
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={ref} className={className} {...props}>
      {children}
    </section>
  );
}
