import { DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DownloadButton({ authorized }: { authorized: boolean }) {
  return <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b bg-background py-3">
    <Button disabled size="sm" variant="outline"><DownloadIcon />下载文件包</Button>
    <p className="text-xs text-muted-foreground">{authorized ? "已有下载权益，文件下载暂未开放。" : "完整文件包需有效订阅或购买本技能；下载暂未开放。"}</p>
  </div>;
}
