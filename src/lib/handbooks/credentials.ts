import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { PublisherIdentity } from "@/lib/publishing/identity";

export const credentialHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const newHandbookCredential = () => `whp_${randomBytes(32).toString("hex")}`;

/** Scoped credentials are accepted only by the handbook API, never by /api/admin. */
export async function authenticateHandbookPublisher(request: Request): Promise<Extract<PublisherIdentity, { kind: "handbook" }> | null> {
  const match = /^Bearer (whp_[a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return null;
  const db = createSupabaseServiceClient({ timeoutMs: 10000 });
  const result = await db.rpc("touch_handbook_credential", { p_hash: credentialHash(match[1]) });
  if (result.error?.message.includes("CREDENTIAL_REVOKED")) return null;
  if (result.error) throw new Error("Publisher identity unavailable");
  if (!result.data) return null;
  const owner = await db.from("profiles").select("id").eq("id", result.data.owner_id).eq("is_owner", true).maybeSingle();
  if (owner.error) throw new Error("Publisher identity unavailable");
  if (!owner.data) return null;
  return { kind: "handbook", ownerId: result.data.owner_id, credentialId: result.data.id };
}
