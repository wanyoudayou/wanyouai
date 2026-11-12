"use client";

import { Button } from "@/components/ui/button";

export function ContentLoadError({ retry }: { retry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12" role="alert">
      <h1 className="text-xl font-medium">内容暂时加载失败</h1>
      <p className="text-sm text-muted-foreground">请稍后重试。</p>
      <Button variant="outline" onClick={retry}>重新加载</Button>
    </div>
  );
}
