"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Gap kept above and below the ask box once the hero is fully compressed. */
const BAR_PADDING = 12;

/**
 * Scroll-linked compression for the home hero (页面契约 3.1 块 1).
 *
 * The section stays in normal flow at its full height and sticks with a
 * negative `top`, so it scrolls up until only a bar holding the ask box is
 * left under the shell header; content below never reflows. Progress 0…1 is
 * written to CSS variables and hero.css derives the fades, the title scale and
 * the slower-moving artwork from it. Without the ask box nothing is pinned and
 * the hero scrolls away as before. Before hydration the hero is static.
 */
export function HeroCollapse({
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
    let headerHeight = 0;
    let range = 0;
    let frame = 0;

    const update = () => {
      frame = 0;
      const travelled = Math.min(Math.max(headerHeight - el.getBoundingClientRect().top, 0), range);
      const progress = range > 0 ? travelled / range : 0;
      el.style.setProperty("--opc-hero-shift", `${travelled}px`);
      el.style.setProperty("--opc-hero-p", progress.toFixed(4));
      el.toggleAttribute("data-collapsed", progress >= 0.999);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const measure = () => {
      const question = el.querySelector<HTMLElement>(".opc-hero__question form");
      headerHeight = header?.offsetHeight ?? 0;
      if (!question?.offsetHeight) {
        range = 0;
        el.removeAttribute("data-collapse");
        el.style.removeProperty("--opc-hero-top");
      } else {
        range = Math.max(el.offsetHeight - (question.offsetHeight + BAR_PADDING * 2), 0);
        el.setAttribute("data-collapse", "");
        el.style.setProperty("--opc-hero-top", `${headerHeight - range}px`);
        el.style.setProperty("--opc-hero-bar-gap", `${BAR_PADDING}px`);
      }
      update();
    };

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (header) observer.observe(header);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      observer.disconnect();
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
