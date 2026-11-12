"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

type Turnstile = { render(el: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void };
const api = () => (window as unknown as { turnstile?: Turnstile }).turnstile;
export function TurnstileWidget({ siteKey, action = "avatar", onToken, onReady, onError }: {
  siteKey: string; action?: "avatar" | "inquiry"; onToken(token: string | null): void;
  onReady?: () => void; onError?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const callbacks = useRef({ onToken, onReady, onError });
  useEffect(() => { callbacks.current = { onToken, onReady, onError }; });
  useEffect(() => {
    let widgetId: string | undefined;
    let disposed = false;
    let script = document.querySelector<HTMLScriptElement>('script[data-wanyou-turnstile]');
    const fail = () => {
      if (disposed) return;
      callbacks.current.onToken(null);
      callbacks.current.onError?.();
    };
    const loadingDeadline = setTimeout(() => {
      if (!api()) script?.remove();
      fail();
    }, 20000);
    const render = () => {
      if (disposed || widgetId || !hostRef.current || !api()) return;
      clearTimeout(loadingDeadline);
      try {
        widgetId = api()!.render(hostRef.current, {
          sitekey: siteKey, action, size: "compact", theme: resolvedTheme === "dark" ? "dark" : "light",
          retry: callbacks.current.onError ? "never" : "auto",
          callback: (token: string) => { if (!disposed) callbacks.current.onToken(token); },
          "expired-callback": fail,
          "timeout-callback": fail,
          "error-callback": fail,
        });
        callbacks.current.onReady?.();
      } catch { fail(); }
    };
    const scriptError = () => { clearTimeout(loadingDeadline); script?.remove(); fail(); };
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
      script.addEventListener("error", scriptError);
    }
    return () => {
      disposed = true;
      clearTimeout(loadingDeadline);
      callbacks.current.onToken(null);
      script?.removeEventListener("load", render);
      script?.removeEventListener("error", scriptError);
      try { if (widgetId) api()?.remove(widgetId); } catch { /* Widget may already be removed. */ }
    };
  }, [siteKey, action, resolvedTheme]);
  return <div ref={hostRef} className="my-1 min-h-16" />;
}
