"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * 栏目本地状态：键名自动带栏目前缀；存储不可用（隐私窗口、配额、禁用）时只保留内存值。
 * 只用于读者自己的进度与偏好，不能保存需要可靠持久或跨设备的数据。
 */
export function usePersistentState<T>(section: string, key: string, initial: T) {
  const storageKey = `section:${section}:${key}`;
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage after mount to keep SSR markup stable
      if (saved !== null) setValue(JSON.parse(saved) as T);
    } catch {
      /* storage unavailable: keep the in-memory value */
    }
  }, [storageKey]);
  const update = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(resolved));
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
