import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sameSiteOrigin, validPublisherToken } from "./auth";
import type { PublisherStore } from "./pipeline";
import type { PublishResponse } from "./types";
import { publicMediaUrl } from "./media-url";
import { registeredMedia } from "@/lib/media/repository";
import type { PublisherIdentity } from "./identity";

export async function publisherIdentity(request: Request): Promise<PublisherIdentity | null> {
  const authorization = request.headers.get("authorization");
  if (authorization)
    return validPublisherToken(authorization, process.env.PUBLISH_TOKEN) ? { kind: "legacy-publisher" } : null;
  if (!sameSiteOrigin(request.headers.get("origin"), process.env.SITE_URL))
    return null;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  const owner = await client.rpc("is_owner");
  return !owner.error && owner.data === true ? { kind: "owner", ownerId: data.user.id } : null;
}

export async function authenticatePublisher(request: Request) {
  return (await publisherIdentity(request)) !== null;
}

export function createPublisherStore(): PublisherStore {
  const client = createSupabaseServiceClient({ timeoutMs: 15000 });
  const bucket = client.storage.from(
    process.env.SUPABASE_STORAGE_MEDIA_BUCKET || "media",
  );
  return {
    async replay(id) {
      const { data, error } = await client
        .from("publish_requests")
        .select("response")
        .eq("client_request_id", id)
        .maybeSingle();
      if (error) throw new Error("Publication replay unavailable");
      return (data?.response ?? null) as PublishResponse | null;
    },
    async commit(id, payload) {
      const { data, error } = await client.rpc("commit_publication", {
        p_request_id: id,
        p_payload: payload,
      });
      if (error || !data)
        throw new Error("Publication transaction unavailable");
      return data as PublishResponse;
    },
    revalidate: revalidatePath,
    media: {
      lookup: registeredMedia,
      publicUrl: publicMediaUrl,
      async download(path) {
        const { data, error } = await bucket.download(
          path,
          {},
          { signal: AbortSignal.timeout(15000) },
        );
        if (error) {
          if (
            ("statusCode" in error && String(error.statusCode) === "404") ||
            error.message === "Object not found"
          )
            return null;
          throw new Error("Media storage unavailable");
        }
        if (data.size > 10 * 1024 * 1024)
          return new Uint8Array(10 * 1024 * 1024 + 1);
        return new Uint8Array(await data.arrayBuffer());
      },
      async upload(path, bytes, mime) {
        const { error } = await bucket.upload(path, bytes, {
          contentType: mime,
          upsert: false,
        });
        if (
          error &&
          !("statusCode" in error && String(error.statusCode) === "409")
        )
          throw new Error("Media upload unavailable");
      },
    },
  };
}
