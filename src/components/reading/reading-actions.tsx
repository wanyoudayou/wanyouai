"use client";

import { Button } from "@/components/ui/button";
import { useRightPanel } from "@/components/shell/right-panel";

export function ReadingActions({ discussion }: { discussion: boolean }) {
  const { available } = useRightPanel();
  if (!available) return null;
  return <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
    <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new Event("wanyou:open-reading-panel"))}>{discussion ? "本页讨论（暂未开放）→" : "向分身提问 →"}</Button>
    <span>评价功能暂未开放</span>
  </div>;
}
