"use client";
import { createContext, useContext } from "react";

/** 全站订阅入口状态（与左栏订阅 pill 同源）：首页 Hero 等页面内入口读取，页面本身不按读者区分。 */
export type SubscribeState = {
  /** commerce.payment_enabled —— zpay 配置完成前恒为 false */
  enabled: boolean;
  priceText: string | null;
  href: string;
  /** 已订阅：剩余天数 */
  subscribedDays?: number | null;
};

const SubscribeStateContext = createContext<SubscribeState | null>(null);
export const SubscribeStateProvider = SubscribeStateContext.Provider;
export function useSubscribeState() {
  return useContext(SubscribeStateContext);
}
