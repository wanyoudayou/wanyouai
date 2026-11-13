"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useRightPanel } from "@/components/shell/right-panel";
import { useSubscribeState } from "@/components/shell/subscribe-state";
import { HERO_CHAT_LABEL, type HeroAction } from "@/types/site";


const COMPOSER = 'textarea[aria-label="向站主的分身提问"]';

/** 打开右栏（<1280 为抽屉）后把光标放进分身输入框；面板挂载需要几帧。 */
function openChat() {
  window.dispatchEvent(new Event("wanyou:open-reading-panel"));
  let frames = 0;
  const focus = () => {
    const composer = [...document.querySelectorAll<HTMLTextAreaElement>(COMPOSER)].find(
      (element) => element.offsetParent !== null,
    );
    if (composer) composer.focus();
    else if (++frames < 30) requestAnimationFrame(focus);
  };
  requestAnimationFrame(focus);
}

/**
 * 名片 Hero 行动按钮（页面契约 3.1）：订阅与「和我聊聊」，至多两个。
 * 订阅与左栏 pill 同源：未开通收款或未定价时不渲染，已订阅显示会员剩余天数；
 * 分身关闭时不渲染聊天按钮。两者都不可用时整行不渲染，不出现无效按钮。
 */
export function HeroActions({
  subscribe,
  chat,
  subscribeIcon,
  subscribeHint,
}: {
  subscribe: HeroAction;
  chat: HeroAction;
  subscribeIcon?: ReactNode;
  subscribeHint?: string | null;
}) {
  const state = useSubscribeState();
  const { available } = useRightPanel();
  const member = subscribe.enabled && state?.subscribedDays != null;
  const offer = subscribe.enabled && !member && !!state?.enabled && !!state.priceText;
  const showChat = chat.enabled && available;
  if (!member && !offer && !showChat) return null;
  return (
    <div className="opc-hero__actions">
      <div className="opc-hero__buttons">
        {offer && (
          <Button size="lg" className="rounded-full px-6" asChild>
            <Link href={state!.href}>
              {subscribeIcon}
              {subscribe.label ?? `订阅 · ${state!.priceText}`}
            </Link>
          </Button>
        )}
        {member && (
          <Button size="lg" variant="outline" className="rounded-full px-6" asChild>
            <Link href="/me">订阅会员 · 剩余 {state!.subscribedDays} 天</Link>
          </Button>
        )}
        {showChat && (
          <Button
            type="button"
            size="lg"
            variant={offer ? "outline" : "default"}
            className="rounded-full px-6"
            onClick={openChat}
          >
            <MessageCircleIcon aria-hidden="true" />
            {chat.label ?? HERO_CHAT_LABEL}
          </Button>
        )}
      </div>
      {offer && subscribeHint && <p className="opc-hero__hint">{subscribeHint}</p>}
    </div>
  );
}
