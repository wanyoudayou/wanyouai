"use server";
import { getAdminIdentity } from "@/lib/admin/session";
import { anonymousDraftPreview } from "@/lib/admin/preview";
import { MarkdownContent } from "@/components/reading/markdown-content";

export async function previewDraft(markdown: string, access: string) {
  if (!(await getAdminIdentity()).owner) throw new Error("需要站主身份");
  const preview = anonymousDraftPreview(markdown, access);
  return {
    content: <MarkdownContent markdown={preview.markdown} />,
    gated: preview.gated,
    publicWithPaywall: preview.publicWithPaywall,
    diagnostics: preview.diagnostics,
  };
}
