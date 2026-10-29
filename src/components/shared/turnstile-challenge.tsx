"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TurnstileWidget } from "./turnstile-widget";

/** A challenge belongs to one pending send; tokens are never kept for later messages. */
export function TurnstileChallenge({ siteKey, onVerified, onCancel, onRestoreFocus }: {
  siteKey: string;
  onVerified: (token: string) => void;
  onCancel: () => void;
  onRestoreFocus: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  return <Dialog.Root open onOpenChange={open => { if (!open) onCancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50" />
      <Dialog.Content
        className="fixed top-1/2 left-1/2 z-[70] max-h-[90dvh] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border bg-popover p-6 text-popover-foreground shadow-lg"
        onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}
      >
        <Dialog.Title className="pr-7 text-lg font-semibold">发送前请完成人机验证</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
          验证通过后会自动发送刚才的问题；取消会保留输入。
        </Dialog.Description>
        <div className="mt-4 flex min-h-40 flex-col items-center justify-center gap-2">
          {status === "loading" && <p role="status" className="text-sm text-muted-foreground">正在加载验证…</p>}
          {status === "error" ? <>
            <p role="alert" className="text-sm text-destructive">验证未完成，问题尚未发送。请重新验证，或取消后稍后再试。</p>
            <Button variant="outline" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>重新验证</Button>
          </> : <TurnstileWidget key={attempt} siteKey={siteKey}
            onReady={() => setStatus("ready")}
            onError={() => setStatus("error")}
            onToken={token => { if (token) onVerified(token); }} />}
        </div>
        <Button className="mt-4 w-full" variant="outline" onClick={onCancel}>取消发送</Button>
        <Dialog.Close className="absolute top-5 right-5 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label="关闭验证">
          <XIcon className="size-4" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
