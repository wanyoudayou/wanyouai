import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseRequestOptions } from "./request-options";
import { isPublicSupabaseKey } from "@/lib/config/registry.mjs";

export function createSupabaseServiceClient({ timeoutMs, signal }: { timeoutMs?: number; signal?: AbortSignal } = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing server-only Supabase configuration: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  if (isPublicSupabaseKey(serviceRoleKey)) {
    throw Object.assign(new Error("SUPABASE_SERVICE_ROLE_KEY requires a Supabase Secret or service_role key, not a public key"), { code: "PUBLIC_SERVICE_KEY" });
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    ...supabaseRequestOptions({ timeoutMs, signal }),
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
