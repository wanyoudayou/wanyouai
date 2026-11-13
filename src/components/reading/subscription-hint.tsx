import {
  BookOpenIcon,
  CakeSliceIcon,
  CoffeeIcon,
  CupSodaIcon,
  GiftIcon,
  HeartIcon,
  IceCreamConeIcon,
  MilkIcon,
  SandwichIcon,
  SparklesIcon,
  TicketIcon,
  UtensilsCrossedIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { subscriptionHintLine, type SubscriptionHintIcon } from "@/lib/subscription-hint";
import type { CommerceConfig } from "@/types/site";

const ICONS: Record<SubscriptionHintIcon, LucideIcon> = {
  coffee: CoffeeIcon,
  "cup-soda": CupSodaIcon,
  milk: MilkIcon,
  "cake-slice": CakeSliceIcon,
  "ice-cream": IceCreamConeIcon,
  sandwich: SandwichIcon,
  utensils: UtensilsCrossedIcon,
  "book-open": BookOpenIcon,
  ticket: TicketIcon,
  gift: GiftIcon,
  heart: HeartIcon,
  sparkles: SparklesIcon,
};

type HintSource = Pick<CommerceConfig, "subscriptionPrice" | "subscriptionHint">;

/** 订阅按钮内的装饰图标；未配置返回 null。读屏只读按钮文字。 */
export function subscriptionHintIcon(commerce: HintSource) {
  const name = commerce.subscriptionPrice ? commerce.subscriptionHint?.icon : null;
  if (!name) return null;
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" data-subscription-hint-icon={name} />;
}

/** 订阅按钮下方的月均与站主提示；未配置提示或未定价时不渲染。 */
export function SubscriptionHint({ commerce, className }: { commerce: HintSource; className?: string }) {
  const line = subscriptionHintLine(commerce.subscriptionPrice, commerce.subscriptionHint);
  if (!line) return null;
  return <p data-subscription-hint className={cn("text-xs text-muted-foreground", className)}>{line}</p>;
}
