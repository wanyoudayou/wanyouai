import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 稳定散列：同一标题总得到同一色调与角度，不依赖随机数，服务端与客户端一致。 */
export function coverVariant(seed: string, variants = 4) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % variants;
}

/** 中文取前两个字，其他文字取首字母大写；去掉开头的标点与空白。 */
export function coverMonogram(title: string) {
  const chars = Array.from(title.trim().replace(/^[\p{P}\p{S}\s]+/u, ""));
  if (!chars.length) return "";
  return /\p{Script=Han}/u.test(chars[0])
    ? chars.slice(0, 2).join("")
    : chars[0].toUpperCase();
}

/**
 * 无封面时的生成式封面：按标题选取四种品牌色调之一，并以首字作水印，
 * 使列表中的卡片可以一眼区分。颜色全部来自 Design Tokens。
 */
export function GeneratedCover({
  title,
  Icon,
  className,
}: {
  title: string;
  Icon: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn("opc-generated-cover", className)}
      data-variant={coverVariant(title)}
      aria-hidden
    >
      <span className="opc-generated-cover-monogram">{coverMonogram(title)}</span>
      <Icon className="opc-generated-cover-icon size-4" />
    </div>
  );
}
