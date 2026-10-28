import type { Frontmatter } from "../publishing/types";

/** Fill omitted input from the current article, then its unpublished draft. */
export function preservedHandbookAccess(requested: unknown, existing: unknown, latestSnapshot: unknown, options: { draftUpload?: boolean; readme?: boolean } = {}): Frontmatter["access"] | undefined {
  const draft = latestSnapshot && typeof latestSnapshot === "object" && "frontmatter" in latestSnapshot ? latestSnapshot.frontmatter : undefined;
  const draftAccess = draft && typeof draft === "object" && "access" in draft ? draft.access : undefined;
  const value = options.draftUpload ? existing ?? draftAccess ?? (options.readme ? "public" : "registered") : requested ?? existing ?? draftAccess;
  return value === "public" || value === "registered" || value === "subscriber" || value === "paid" ? value : undefined;
}
