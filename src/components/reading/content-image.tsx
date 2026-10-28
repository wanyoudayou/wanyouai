import { safeImageSource } from "@/lib/reading/markdown";

export function ContentImage({ src, alt = "" }: { src: string; alt?: string }) {
  const safe = safeImageSource(src);
  if (!safe) return <span className="text-sm text-muted-foreground">图片暂不可显示</span>;
  const dimensions = /\|(\d{1,4})(?:x(\d{1,4}))?$/.exec(alt);
  const width = dimensions ? Math.max(1, Number(dimensions[1])) : 960;
  const height = dimensions?.[2] ? Math.max(1, Number(dimensions[2])) : Math.round(width * 9 / 16);
  // The public image is already served by Storage; a plain element also keeps
  // Server Action previews independent of Next's client image module registry.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={safe} alt={alt.replace(/\|\d{1,4}(?:x\d{1,4})?$/, "")} width={width} height={height} loading="lazy" decoding="async" className="my-6 h-auto max-w-full rounded-lg" />;
}
