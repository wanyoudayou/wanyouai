import { mediaStoragePath, storagePublicUrl } from "@/lib/publishing/media-url";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ slug: string; file: string }> }) {
  const { slug, file } = await context.params;
  const storagePath = mediaStoragePath(slug, file);
  if (!storagePath) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const location = storagePublicUrl(
      storagePath,
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_STORAGE_MEDIA_BUCKET || "media",
    );
    return new Response(null, { status: 307, headers: { Location: location, "Cache-Control": "public, max-age=60" } });
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
