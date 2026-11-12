import { inspectMarkdown } from "@/lib/publishing/markdown";

/** Reuse a valid cutpoint; never insert a second one or overwrite selected text. */
export function paywallEdit(text: string, cursor: number): { existing: number } | { at: number; insert: string; anchor: number } {
  const inspection = inspectMarkdown(text, "public");
  if (inspection.paywallOffsets.length) return { existing: inspection.paywallOffsets[0] };
  const at = Math.max(0, Math.min(text.length, cursor));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const prefix = before && !before.endsWith("\n\n") ? before.endsWith("\n") ? "\n" : "\n\n" : "";
  const suffix = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  return { at, insert: `${prefix}<!-- paywall -->${suffix}`, anchor: at + prefix.length + "<!-- paywall -->".length + suffix.length };
}
