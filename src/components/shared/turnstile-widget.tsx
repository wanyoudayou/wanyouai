"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

type Turnstile = { render(el: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
const api = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
export function TurnstileWidget({ siteKey, action = "avatar", onToken }: {
  siteKey: string; action?: "avatar" | "inquiry"; onToken(token: string | null): void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const callback = useRef(onToken);
  useEffect(() => { callback.current = onToken; });
  useEffect(() => {
    let widgetId: string | undefined;
    let disposed = false;
    const render = () => {
      if (disposed || widgetId || !hostRef.current || !api()) return;
      widgetId = api()!.render(hostRef.current, {
        sitekey: siteKey, action, size: "compact", theme: resolvedTheme === "dark" ? "dark" : "light",
        callback: (token: string) => callback.current(token),
        "expired-callback": () => callback.current(null),
        "error-callback": () => callback.current(null),
      });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-wanyou-turnstile]');
    if (api()) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.dataset.wanyouTurnstile = "true";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      disposed = true;
      callback.current(null);
      script?.removeEventListener("load", render);
      try { if (widgetId) api()?.remove(widgetId); } catch { /* Widget may already be removed. */ }
    };
  }, [siteKey, action, resolvedTheme]);
  return <div ref={hostRef} className="my-1 min-h-16" />;
}
