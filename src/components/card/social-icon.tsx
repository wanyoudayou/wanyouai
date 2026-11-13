import {
  AtSignIcon,
  BookHeartIcon,
  GitBranchIcon,
  GlobeIcon,
  MessageCircleIcon,
  PodcastIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SocialPlatform } from "@/types/site";

/**
 * 自媒体平台图标：与站点导航同一套 Lucide 线性图标（品牌标志不进入站点图标集）。
 * 名片展示与后台编辑共用，平台增减时同步 SOCIAL_PLATFORMS。
 */
export const SOCIAL_ICONS: Record<SocialPlatform, LucideIcon> = {
  x: AtSignIcon,
  github: GitBranchIcon,
  xiaohongshu: BookHeartIcon,
  xiaoyuzhou: PodcastIcon,
  "wechat-official": MessageCircleIcon,
  custom: GlobeIcon,
};

/** 圆角图标块：强调色浅底 + 主色线性图标，与名片、收费方案中的图标块一致。 */
export function SocialIcon({ platform, className }: { platform: SocialPlatform; className?: string }) {
  const Icon = SOCIAL_ICONS[platform];
  return (
    <span
      aria-hidden="true"
      data-social-icon={platform}
      className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary", className)}
    >
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
  );
}
