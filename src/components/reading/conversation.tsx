"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { SendHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

/** Shared presentation only. Each conversation keeps its own authorization and request state. */
export function ConversationBody({ children, scrollKey }: { children: ReactNode; scrollKey: unknown }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]");
    viewport?.scrollTo({ top: viewport.scrollHeight });
  }, [scrollKey]);
  return <ScrollArea ref={scrollRef} className="min-h-0 min-w-0 flex-1"><div className="flex min-w-0 flex-col gap-3 p-4">{children}</div></ScrollArea>;
}

export function ConversationBubble({ user = false, children }: { user?: boolean; children: ReactNode }) {
  return <div className={cn("flex min-w-0", user ? "justify-end" : "justify-start")}>
    <div className={cn("min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-sm leading-[1.7] [overflow-wrap:anywhere]", user ? "whitespace-pre-wrap bg-primary text-primary-foreground" : "border bg-card")}>{children}</div>
  </div>;
}

export function ConversationComposer({ value, onChange, onSubmit, disabled, sendDisabled, label, placeholder, maxLength }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void;
  disabled: boolean; sendDisabled?: boolean; label: string; placeholder: string; maxLength: number;
}) {
  const draftRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = draftRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);
  const submit = () => { if (!disabled && !sendDisabled && value.trim()) onSubmit(); };
  return <div className="relative">
    <textarea ref={draftRef} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
    }} rows={2} placeholder={placeholder} aria-label={label} maxLength={maxLength} disabled={disabled}
      className="block max-h-40 min-h-18 w-full resize-none rounded-2xl border bg-muted/40 py-2.5 pr-12 pl-3 text-sm leading-[1.7] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50" />
    <Button type="button" size="icon" className="absolute right-2 bottom-2 rounded-full" onClick={submit} disabled={disabled || sendDisabled || !value.trim()} aria-label="发送"><SendHorizontalIcon /></Button>
  </div>;
}
