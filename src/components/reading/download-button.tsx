import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 旧技能专辑的交付提示：文件包已迁到独立 Skill 页面下载，原权益继续有效。 */
export function DownloadButton({ authorized }: { authorized: boolean }) {
  return <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background py-3">
    <Button asChild size="sm" variant="outline"><Link href="/skills"><DownloadIcon />前往技能页下载</Link></Button>
    <p className="text-xs text-muted-foreground">{authorized ? "你的已购权益在对应 Skill 页面可直接下载最新版本。" : "完整文件包需有效订阅或购买本技能，在对应 Skill 页面下载。"}</p>
  </div>;
}
