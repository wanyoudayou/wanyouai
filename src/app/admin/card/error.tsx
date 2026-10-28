"use client";

export default function CardSettingsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-10">
      <h1 className="text-2xl font-medium">名片配置暂时不可用</h1>
      <p className="text-sm text-muted-foreground">登录状态或站点数据暂时无法读取。请检查网络后重试；页面错误不代表配置已丢失。</p>
      <button type="button" onClick={() => retry()} className="rounded-md border px-4 py-2 text-sm">重新加载</button>
    </div>
  );
}
