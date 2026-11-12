"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const subscribe = () => () => {};
const mounted = () => true;
const server = () => false;
const appearances = {
  system: { label: "跟随系统", Icon: MonitorIcon, next: "light" },
  light: { label: "浅色模式", Icon: SunIcon, next: "dark" },
  dark: { label: "深色模式", Icon: MoonIcon, next: "system" },
} as const;

/** compact：只显示图标的圆形按钮，供前台侧栏与登录入口并排；可访问名称不变。 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const ready = useSyncExternalStore(subscribe, mounted, server);
  const { theme, setTheme } = useTheme();
  const mode = ready && (theme === "light" || theme === "dark") ? theme : "system";
  const { label, Icon, next } = appearances[mode];
  const action = `点击切换为${appearances[next].label}`;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={
        compact
          ? "size-9 shrink-0 rounded-full border-border p-0 text-muted-foreground shadow-none hover:text-foreground active:bg-accent active:shadow-inner motion-reduce:transition-none"
          : "h-9 w-32 self-start gap-2 rounded-full border-border text-xs font-normal text-muted-foreground shadow-none hover:text-foreground active:bg-accent active:shadow-inner motion-reduce:transition-none"
      }
      aria-label={`外观：${label}；${action}`}
      title={action}
      data-theme-mode={mode}
      disabled={!ready}
      onClick={() => setTheme(next)}
    >
      <Icon className="size-4" aria-hidden />
      {compact ? null : <span>{label}</span>}
    </Button>
  );
}
