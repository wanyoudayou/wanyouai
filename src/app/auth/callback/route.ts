import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { adminCallbackUrl } from "@/lib/admin/auth-flow";
import { bootstrapAdminOwner } from "@/lib/admin/owner-bootstrap-server";

export async function GET(request: Request) {
  const destination = new URL("/admin", adminCallbackUrl(process.env.SITE_URL));
  const code = new URL(request.url).searchParams.get("code");
  try {
    if (!code || code.length > 2048) throw new Error("Missing code");
    const client = await createSupabaseServerClient();
    const exchange = await client.auth.exchangeCodeForSession(code);
    if (exchange.error) throw new Error("Invalid code");
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user || !user.email_confirmed_at) throw new Error("Unverified user");
    let outcome;
    try { outcome = await bootstrapAdminOwner(client, user); }
    catch { destination.searchParams.set("notice", "owner-check-failed"); }
    if (outcome === "unconfigured") destination.searchParams.set("notice", "owner-unconfigured");
    if (outcome === "not_allowed" || outcome === "already_claimed") destination.searchParams.set("notice", "not-owner");
  } catch { destination.searchParams.set("notice", "invalid-link"); }
  return NextResponse.redirect(destination, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
