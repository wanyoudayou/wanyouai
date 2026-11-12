import "server-only";
import { createClient } from "@supabase/supabase-js";
import { readPublicCatalog } from "./public-catalog-data";
import { supabaseRequestOptions } from "./supabase/request-options";
export type { CatalogArticle, CatalogSeries, CatalogService, PublicCatalog } from "./public-catalog-data";

/** Always anonymous, even for an owner request; all queries share a 10s deadline. */
export async function getPublicCatalog() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("公开数据配置不可用");
  const cleanup = new AbortController();
  const signal = AbortSignal.any([cleanup.signal, AbortSignal.timeout(10000)]);
  const client = createClient(url, key, {
    ...supabaseRequestOptions({ timeoutMs: 6000, signal, retryReadOnce: true }),
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try { return await readPublicCatalog(client); }
  finally { cleanup.abort(); }
}
