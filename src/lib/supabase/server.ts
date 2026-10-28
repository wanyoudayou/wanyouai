import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseRequestOptions } from "./request-options";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase public configuration: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  const transport = supabaseRequestOptions({
    timeoutMs: 10000,
    signal: AbortSignal.timeout(20000),
    retryReadOnce: true,
    // RLS results depend on the caller. Never reuse a response across sessions.
    fetchImpl: (input, init) => globalThis.fetch(input, { ...init, cache: "no-store" }),
  });
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    ...transport,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Supabase session refresh is
          // handled by middleware or Route Handlers when it is actionable.
        }
      },
    },
  });
}
