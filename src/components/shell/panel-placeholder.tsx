"use client";

import { useEffect } from "react";

import { useRightPanel } from "@/components/shell/right-panel";
import type { PanelPlaceholder } from "@/types/panel";

/**
 * 页面级右栏占位注入：页面（服务端组件）渲染本组件声明占位内容，
 * 卸载时恢复默认招呼。页面文件保持薄，占位只是数据声明。
 */
export function PanelPlaceholder({ value }: { value: PanelPlaceholder }) {
  const { setPlaceholder } = useRightPanel();

  useEffect(() => {
    setPlaceholder(value);
    return () => setPlaceholder({ kind: "default" });
  }, [value, setPlaceholder]);

  return null;
}
