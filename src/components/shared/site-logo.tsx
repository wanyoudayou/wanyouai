import { cn } from "@/lib/utils";

/**
 * 站点 Logo（identity.logo_url）。
 * 未配置图片时退化为「站名首字」方形字标，保证左栏标识位永远不空。
 */
export function SiteLogo({
  url,
  name,
  className,
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  const initial = [...name.trim()][0] ?? "万";
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Logo 为站主可配置的自托管/外部资源
      <img
        src={url}
        alt={`${name} Logo`}
        className={cn("size-9 shrink-0 object-contain", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground",
        className,
      )}
    >
      {initial}
    </span>
  );
}
