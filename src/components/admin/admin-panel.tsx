"use client";
import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
const narrowQuery = "(max-width: 1279px)";
function subscribeViewport(onChange: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const isNarrowViewport = () => window.matchMedia(narrowQuery).matches;
const serverViewport = () => false;
type PanelContext = { open: boolean; show: (title: string, origin?: HTMLElement) => void; close: () => void; target: HTMLDivElement | null };
const Context = createContext<PanelContext | null>(null);
export function useAdminPanel() {
  const value = useContext(Context);
  if (!value) throw new Error("Admin panel provider missing");
  return value;
}
export function AdminPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const narrow = useSyncExternalStore(subscribeViewport, isNarrowViewport, serverViewport);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const show = useCallback((title: string, origin?: HTMLElement) => { trigger.current = origin ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null); setTitle(title); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);
  return <Context.Provider value={{ open, show, close, target }}>{children}
    <Sheet open={open} onOpenChange={setOpen} modal={narrow}>
      <SheetContent side="right" className="w-full max-w-full gap-0 sm:w-[36rem] sm:max-w-[36rem]" onInteractOutside={(event) => { if (!narrow) event.preventDefault(); }} onCloseAutoFocus={(event) => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
        <SheetHeader className="border-b pr-12"><SheetTitle>快捷操作</SheetTitle><SheetDescription>{title}</SheetDescription></SheetHeader>
        <div ref={setTarget} className="min-h-0 flex-1 overflow-y-auto p-5" />
      </SheetContent>
    </Sheet>
  </Context.Provider>;
}
export function AdminPanelPortal({ children }: { children: ReactNode }) {
  const { target } = useAdminPanel();
  return target ? createPortal(children, target) : null;
}
export function AdminWorkspaceGrid({ children }: { children: ReactNode }) {
  const { open } = useAdminPanel();
  return <div className={open ? "min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_36rem]" : "min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"}>{children}</div>;
}
