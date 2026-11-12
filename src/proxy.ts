import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { needsSessionRefresh } from "@/lib/supabase/session-routing";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!needsSessionRefresh(request.nextUrl.pathname)) return response;
  if (!request.cookies.getAll().some(({ name }) => name.startsWith("sb-"))) return response;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const client = createServerClient(url, key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values) {
      for (const { name, value } of values) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of values) response.cookies.set(name, value, options);
      response.headers.set("Cache-Control", "private, no-store");
    },
  } });
  await client.auth.getClaims();
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
