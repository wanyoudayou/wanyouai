import type { SkillFile } from "./package-policy";
export const SKILL_BUCKET = "skill-packages";
export type SkillSettings = { id: number; price: number; online_enabled: boolean; usage_guide: string; current_release: string | null; revision: number; legacy_series_id: number | null };
export type SkillRelease = { id: string; skill_id: number; version: string; notes: string; package_sha256: string; byte_size: number; manifest: SkillFile[]; skill_name: string; description: string; online_eligible: boolean; created_at: string };
export class SkillError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const positiveId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
