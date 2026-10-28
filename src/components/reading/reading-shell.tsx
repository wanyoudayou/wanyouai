"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { ChapterNavigation } from "@/types/reading";

interface ReadingShellValue {
  pathname: string;
  navigation: ChapterNavigation | null;
  outline: ReactNode;
  discussion: boolean;
  /** 当前文章 slug（分身钉载用，不含正文）。 */
  articleSlug?: string | null;
  skillPanel?: {
    content: ReactNode;
    online?: ReactNode;
    initialMode?: "download" | "online";
    chat?: { skill: number; title: string; guide: string; initialSession?: string };
  };
}
const ReadingShellContext = createContext<{
  reading: ReadingShellValue | null;
  setReading: (value: ReadingShellValue | null) => void;
}>({ reading: null, setReading: () => {} });

export function ReadingShellProvider({ children }: { children: ReactNode }) {
  const [reading, setReading] = useState<ReadingShellValue | null>(null);
  return <ReadingShellContext.Provider value={{ reading, setReading }}>{children}</ReadingShellContext.Provider>;
}

export function useReadingShell() {
  const { reading } = useContext(ReadingShellContext);
  const pathname = usePathname();
  return reading?.pathname === pathname ? reading : null;
}

/** 传递目录与已授权的交付节点；不传 Skill 包正文或服务端凭据。 */
export function ReadingShellBridge({ value }: { value: ReadingShellValue }) {
  const { setReading } = useContext(ReadingShellContext);
  useEffect(() => { setReading(value); return () => setReading(null); }, [setReading, value]);
  return null;
}
