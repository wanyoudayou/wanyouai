export const SKILL_LIMITS = {
  archiveBytes: 20 * 1024 * 1024,
  expandedBytes: 50 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
  files: 500,
  instructionBytes: 32 * 1024,
  referenceBytes: 32 * 1024,
} as const;
export class SkillPackageError extends Error {}
export function packagePath(value: string): string {
  const normalized = value.normalize("NFC");
  if (!normalized || normalized.length > 512 || normalized !== value || /[\\\u0000-\u001f\u007f:?#]/.test(value))
    throw new SkillPackageError("文件路径包含不支持的字符或编码。");
  const parts = value.split("/");
  if (parts.length > 32 || parts.some(p => !p || p === "." || p === ".." || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw new SkillPackageError("文件路径不安全，或无法跨平台安装。");
  return value;
}
export function excludedPackagePath(path: string) {
  return path.split("/").some(p => [".git", ".obsidian", "node_modules", ".next", ".cache", "__MACOSX", ".DS_Store"].includes(p));
}
export function credentialFile(path: string) {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1)!;
  return (name === ".env" || name.startsWith(".env.")) && ![".env.example", ".env.sample", ".env.template"].includes(name)
    || ["id_rsa", "id_ed25519", "id_ecdsa", ".npmrc", ".netrc"].includes(name)
    || /\.(p12|pfx|jks|keystore)$/.test(name)
    || parts.some(p => [".ssh", ".aws", ".vercel"].includes(p));
}
export type SkillFile = { path: string; size: number; sha256: string; text: boolean };
export function textReference(path: string) {
  return /\.(md|markdown|txt|json|ya?ml|csv|tsv)$/i.test(path);
}
