"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 支付跳回后仍未到账时的自动刷新兜底：每 3s 重新走服务端查单（router.refresh 保留 URL），最多约 30s。 */
export function ReturnPoll() {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      if (count > 10) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
