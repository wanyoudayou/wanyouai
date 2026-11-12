const storagePathPattern =
  /^media\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.(png|jpg|webp|gif)$/;
const filePattern = /^([a-f0-9]{64})\.(png|jpg|webp|gif)$/;

/** Only canonical local image routes qualify for registry lookup; never fetch arbitrary URLs. */
export function canonicalMediaPath(url: string): string | null {
  if (!url.startsWith("/media/")) return null;
  const path = url.slice(1);
  return storagePathPattern.test(path) ? path : null;
}

/** Keep published Markdown independent of the current Supabase project URL. */
export function publicMediaUrl(storagePath: string): string {
  const match = storagePathPattern.exec(storagePath);
  if (!match || match[1].length < 2 || match[1].length > 120)
    throw new Error("Invalid public media path");
  return `/media/${match[1]}/${match[2]}.${match[3]}`;
}

export function mediaStoragePath(slug: string, file: string): string | null {
  if (
    slug.length < 2 ||
    slug.length > 120 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !filePattern.test(file)
  )
    return null;
  return `media/${slug}/${file}`;
}

export function storagePublicUrl(
  storagePath: string,
  supabaseUrl: string,
  bucket: string,
): string {
  if (!storagePathPattern.test(storagePath) || !/^[a-z0-9_-]+$/.test(bucket))
    throw new Error("Invalid Storage public media configuration");
  const base = new URL(supabaseUrl);
  if (
    base.username ||
    base.password ||
    (base.protocol !== "https:" &&
      !(
        base.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(base.hostname)
      ))
  ) {
    throw new Error("Invalid Supabase URL");
  }
  return new URL(
    `/storage/v1/object/public/${bucket}/${storagePath}`,
    base,
  ).toString();
}

/** A historical snapshot may contain an old project's absolute public URL. */
export function isLegacySupabaseMediaUrl(
  url: string,
  verifiedStoragePath: string,
): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !/^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname)
    )
      return false;
    const match = /^\/storage\/v1\/object\/public\/([a-z0-9_-]+)\/(.+)$/.exec(
      parsed.pathname,
    );
    return !!match && match[2] === verifiedStoragePath;
  } catch {
    return false;
  }
}
