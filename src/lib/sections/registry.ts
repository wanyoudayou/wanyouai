import registry from "@/generated/sections.json";

export type SectionTier = "standard" | "extended";
export type SectionAccess = "public" | "login" | "subscriber";

/** 由 `npm run sections:build` 从各栏目 manifest.json 生成；只含公开元数据。 */
export interface SectionEntry {
  name: string;
  title: string;
  description: string;
  icon: string;
  tier: SectionTier;
  path: string;
  dependencies: string[];
  budgetKb: number;
  tokens: boolean;
}

export const SECTIONS = (registry as { sections: SectionEntry[] }).sections;

export const SECTION_PREFIX = "/lab";

export function sectionPath(name: string): string {
  return `${SECTION_PREFIX}/${name}`;
}

export function findSection(name: string): SectionEntry | null {
  return SECTIONS.find((section) => section.name === name) ?? null;
}
