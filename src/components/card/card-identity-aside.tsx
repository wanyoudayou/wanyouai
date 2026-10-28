import Link from "next/link";
import { BriefcaseIcon, ClockIcon, GlobeIcon, LanguagesIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OwnerAvatar } from "@/components/shared/owner-avatar";
import type { CardPanelData } from "@/types/panel";
import { MachineCardLink } from "@/components/card/machine-card-link";

/**
 * 名片左身份栏（/card 三栏布局 · dinq 式）：
 * 大头像 → 站名 → 图标事实行 → 联系方式 → 简介 → 可展开的 AI 读取入口。
 */
export function CardIdentityAside({ card, cardJsonUrl }: { card: CardPanelData; cardJsonUrl: string }) {
  const facts: { Icon: typeof BriefcaseIcon; text: string }[] = [
    { Icon: BriefcaseIcon, text: card.ownerName },
    ...(card.languages.length > 0 ? [{ Icon: LanguagesIcon, text: card.languages.join(" / ") }] : []),
    { Icon: GlobeIcon, text: card.timezone },
    ...(card.workingHours ? [{ Icon: ClockIcon, text: card.workingHours }] : []),
  ];
  const cta = card.bookingUrl
    ? { href: card.bookingUrl, label: "预约沟通" }
    : card.email
      ? { href: `mailto:${card.email}`, label: "邮件联系" }
      : null;

  return (
    <aside className="space-y-5" aria-label="名片身份">
      <OwnerAvatar url={card.avatarUrl} name={card.ownerName} className="size-32 text-4xl" />
      <div className="space-y-3">
        <h1 className="text-2xl leading-snug font-medium">{card.siteName}</h1>
        <ul className="space-y-1.5">
          {facts.map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon className="size-4 shrink-0" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        {cta ? (
          <Button asChild className="w-full">
            <Link href={cta.href}>{cta.label}</Link>
          </Button>
        ) : null}
      </div>
      <p className="text-sm leading-[1.8] text-muted-foreground">{card.oneLiner}</p>
      {card.focusAreas.length > 0 ? (
        <p className="flex flex-wrap gap-1.5">
          {card.focusAreas.map((area) => (
            <Badge key={area} variant="outline" className="font-normal text-muted-foreground">{area}</Badge>
          ))}
        </p>
      ) : null}
      <MachineCardLink url={cardJsonUrl} />
    </aside>
  );
}
