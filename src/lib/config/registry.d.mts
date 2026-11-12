export type ConfigStatus = "ready" | "error" | "disabled" | "incomplete" | "skipped";
export type ConfigCheck = { id: string; status: ConfigStatus; hint: string };
export function inspectConfig(env: Record<string, string | undefined>, options?: { existingSite?: boolean }): ConfigCheck[];
export function isPublicSupabaseKey(value: string | undefined): boolean;
export const baseConfig: { id: string; valid: (value: string | undefined) => boolean; hint: string }[];
export const optionalGroups: { id: string; keys: string[]; valid?: (env: Record<string, string | undefined>) => boolean; hint: string }[];
