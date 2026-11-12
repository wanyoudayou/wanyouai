import "server-only";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ensureOwnerAfterLogin, type OwnerBootstrapOutcome } from "./owner-bootstrap";

type SessionClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function ownerRequest(stage: "check" | "claim", operation: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<boolean> {
  try {
    const { data, error } = await operation();
    if (error) throw error;
    return data === true;
  } catch (error) {
    // RPC messages can contain instance data. Log only a bounded diagnostic code.
    const rawCode = error && typeof error === "object" && "code" in error ? error.code : null;
    const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,32}$/.test(rawCode) ? rawCode : "REQUEST_FAILED";
    console.error("owner_bootstrap_failed", { stage, code });
    throw new Error("Owner bootstrap request failed");
  }
}

export async function bootstrapAdminOwner(client: SessionClient, user: User | null): Promise<OwnerBootstrapOutcome> {
  return ensureOwnerAfterLogin(user, process.env.OWNER_EMAIL, {
    isOwner() {
      return ownerRequest("check", () => client.rpc("is_owner"));
    },
    claim(userId, expectedEmail) {
      return ownerRequest("claim", () => createSupabaseServiceClient().rpc("claim_owner_for", {
        p_user_id: userId,
        p_expected_email: expectedEmail,
      }));
    },
  });
}
