import type { SupabaseClient } from "@supabase/supabase-js";
export class StorageSetupError extends Error {}
export type StorageTarget = { id: string; public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] | null };
export function storageTargets(env: Record<string, string | undefined>, options?: { packages?: boolean }): StorageTarget[];
export function inspectStorage(storage: SupabaseClient["storage"], targets: StorageTarget[], options?: { apply?: boolean }): Promise<{ id: string; status: "ready" | "blocked" | "incomplete" | "missing"; hint: string }[]>;
