import { cn } from "@/lib/utils";

/**
 * 站主头像（identity.avatar_url）。
 * 未配置图片时退化为「站主名称首字」圆形字标（参考头像卡片的视觉位置，不引入占位图资产）。
 */
export function OwnerAvatar({
  url,
  name,
  className,
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  const initial = [...name.trim()][0] ?? "主";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 头像为站主可配置的自托管/外部资源
      <img
        src={url}
        alt={`${name} 头像`}
        className={cn("size-20 shrink-0 rounded-full border object-cover", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-20 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-medium text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
