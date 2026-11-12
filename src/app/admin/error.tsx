"use client";
import { Button } from "@/components/ui/button";
export default function AdminError({ retry }: { retry: () => void }) {
  return <div className="space-y-4 px-6 py-12"><h1 className="text-xl font-medium">后台暂时不可用</h1><p className="text-sm text-muted-foreground">无法验证身份或读取后台数据，请稍后重试。</p><Button onClick={retry} variant="outline">重试</Button></div>;
}
