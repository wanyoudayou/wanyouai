"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { initializeStarterStep } from "@/app/admin/setup/actions";
import type { StarterStatus } from "@/lib/starter/server";
import { Button } from "@/components/ui/button";

export function StarterContent({ status }: { status: StarterStatus }) {
  const [selected, setSelected] = useState(status.empty || status.started);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [count, setCount] = useState(status.count);
  const stop = useRef(false);
  const router = useRouter();
  async function start() {
    if (!selected) {
      router.push("/admin/articles");
      return;
    }
    stop.current = false;
    setBusy(true);
    let current = count;
    try {
      for (let i = 0; i < 8 && !stop.current; i++) {
        setMessage(`正在确认进度并导入，已完成 ${current}/8 篇…`);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          initializeStarterStep(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("timeout")), 45000);
          }),
        ]).finally(() => clearTimeout(timer));
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        current = result.count;
        setCount(result.count);
        setMessage(result.message);
        if (result.completed) {
          router.refresh();
          return;
        }
      }
      if (stop.current)
        setMessage("已在本步结束后停止。再次点击可从数据库进度继续。");
    } catch {
      setMessage(
        "连接未完成，已停止等待。稍后继续会先核对数据库进度，不会重复创建内容。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-5"
      aria-label="示例内容初始化"
    >
      <h2 className="text-lg font-semibold">开始使用本站系统</h2>
      <p className="text-sm leading-6 text-muted-foreground">
        创建可编辑的收费方案页与八篇使用指南，完成后加入侧栏。已有内容不会被覆盖，升级不会自动导入。
      </p>
      {!status.available ? (
        <p role="alert" className="text-sm">
          初始化状态暂时无法读取，请先核对数据库升级与连接。
        </p>
      ) : status.completed ? (
        <p className="text-sm">
          示例已导入。可在
          <Link href="/admin/collections" className="text-primary underline">
            专辑
          </Link>
          和
          <Link href="/admin/pages" className="text-primary underline">
            独立页面
          </Link>
          中编辑。
        </p>
      ) : (
        <>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected}
              disabled={busy || status.started}
              onChange={(event) => setSelected(event.target.checked)}
            />
            载入收费方案与使用指南
          </label>
          <div className="flex flex-wrap gap-3">
            <Button onClick={start} disabled={busy}>
              {busy
                ? `导入中 ${count}/8`
                : status.started
                  ? "继续导入"
                  : selected
                    ? "创建示例内容"
                    : "从空站开始"}
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  stop.current = true;
                }}
              >
                本步结束后停止
              </Button>
            )}
          </div>
        </>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
    </section>
  );
}
