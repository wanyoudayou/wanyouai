"use client";

import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRightPanel } from "@/components/shell/right-panel";

/**
 * 首屏问句输入框（页面契约 3.1 纪律）：右栏对话区的快捷入口，不是第二套聊天——
 * 提交唤起右栏并带入问题；placeholder 只锚定站内供给，读 home_config。
 */
export function HeroAskBox({
  placeholder,
}: {
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const { ask, available } = useRightPanel();

  const submit = async () => {
    const question = draft.trim();
    if (!question) return;
    if (!(await ask(question))) return;
    setDraft("");
    window.dispatchEvent(new Event("wanyou:open-reading-panel"));
  };

  if (!available) return null;
  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label="向站主的分身提问"
        className="opc-hero__input h-11 rounded-full bg-background/65 px-4 text-foreground placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="icon"
        className="size-11 rounded-full"
        aria-label="提问"
      >
        <ArrowRightIcon />
      </Button>
    </form>
  );
}
