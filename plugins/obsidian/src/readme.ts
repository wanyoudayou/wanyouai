import { safeVaultPath } from "../../../packages/handbook-protocol/src";

/** Only a root README is the handbook introduction; its spelling is case insensitive. */
export function findReadme(paths: string[], folder: string) {
  safeVaultPath(folder);
  const matches = paths.filter(path => path.startsWith(folder + "/") && path.slice(folder.length + 1).toLowerCase() === "readme.md");
  if (matches.length > 1) throw new Error("根目录有多个仅大小写不同的 README.md，请只保留一份后继续。");
  return matches[0] ?? null;
}

export async function ensureReadme(vault: { paths(): string[]; create(path: string, content: string): Promise<unknown> }, folder: string, allowCreate: boolean) {
  const existing = findReadme(vault.paths(), folder);
  if (existing) return existing;
  if (!allowCreate) throw new Error("缺少根目录 README.md。请勾选“创建空白 README.md”，或自行补充后继续。");
  // Vault.create must reject an existing file; never replace a concurrent local edit.
  const path = `${folder}/README.md`;
  await vault.create(path, "");
  return path;
}
