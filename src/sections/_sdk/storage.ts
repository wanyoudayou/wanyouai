"use client";
import { useCallback, useEffect, useState } from "react";

const CHANGE_EVENT = "section-storage";

function read<T>(storageKey: string): { found: boolean; value?: T } {
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved === null ? { found: false } : { found: true, value: JSON.parse(saved) as T };
  } catch {
    return { found: false };
  }
}

/**
 * 栏目本地状态：键名自动带栏目前缀；存储不可用（隐私窗口、配额、禁用）时只保留内存值。
 * 同一页面中使用同一键的组件，以及同一浏览器的其他标签页，在写入后保持一致。
 * 只用于读者自己的进度与偏好，不能保存需要可靠持久或跨设备的数据。
 */
export function usePersistentState<T>(section: string, key: string, initial: T) {
  const storageKey = `section:${section}:${key}`;
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const load = () => {
      const saved = read<T>(storageKey);
      if (saved.found) setValue(saved.value as T);
    };
    // Hydrate from storage after mount so the server markup stays stable.
    load();
    const onChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === storageKey) load();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) load();
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey]);
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(resolved));
          // Notify other components using the same key once this update has left the render phase.
          queueMicrotask(() => window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: storageKey })));
        } catch {
          /* storage unavailable: keep the in-memory value */
        }
        return resolved;
      });
    },
    [storageKey],
  );
  return [value, update] as const;
}
