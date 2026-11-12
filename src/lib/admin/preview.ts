import { inspectMarkdown } from "@/lib/publishing/markdown";
import { diagnostic } from "@/lib/publishing/types";

export function anonymousDraftPreview(markdown: unknown, access: unknown) {
  if (typeof markdown !== "string" || markdown.length > 1_000_000 || typeof access !== "string" || !["public", "registered", "subscriber", "paid"].includes(access)) {
    return { markdown: "", gated: true, publicWithPaywall: false, diagnostics: [diagnostic("SCHEMA_INVALID", "预览需要有效正文和访问级别。")] };
  }
  const result = inspectMarkdown(markdown, access);
  return { markdown: result.diagnostics.some((d) => d.severity === "error") ? "" : result.preview, gated: access !== "public", publicWithPaywall: access === "public" && result.paywallOffsets.length > 0, diagnostics: result.diagnostics };
}
