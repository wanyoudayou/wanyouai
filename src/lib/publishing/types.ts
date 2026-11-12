export type Frontmatter = {
  title: string;
  slug: string;
  type: "blog" | "chapter" | "skill";
  access: "public" | "registered" | "subscriber" | "paid";
  series_slug?: string;
  price?: number;
  summary?: string;
  cover?: string;
  tags?: string[];
  published_at?: string;
};
export type Media = {
  source_path: string;
  storage_path: string;
  sha256: string;
  mime_type: string;
  width: number;
  height: number;
};
export type PublishInput = {
  client_request_id: string;
  frontmatter: Frontmatter;
  markdown: string;
  media: Media[];
};
export type Diagnostic = {
  code: string;
  severity: "warning" | "error";
  message: string;
  path: string;
};
export type PublishResponse = {
  status: "pass" | "needs_user_action" | "blocked";
  diagnostics: Diagnostic[];
  article: { slug: string; version: number; url: string } | null;
  revalidated: string[];
};
export function diagnostic(code: string, message: string, path = "", severity: Diagnostic["severity"] = "error"): Diagnostic {
  return { code, severity, message, path };
}
export function blocked(diagnostics: Diagnostic[]): PublishResponse {
  return { status: "blocked", diagnostics, article: null, revalidated: [] };
}
