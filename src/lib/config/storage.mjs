export class StorageSetupError extends Error {}

const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export function storageTargets(env, { packages = false, skills = false } = {}) {
  const targets = [
    {
      id: env.SUPABASE_STORAGE_MEDIA_BUCKET || "media",
      public: true,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: imageTypes,
    },
  ];
  targets.push({
    id: "media-uploads",
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: [...imageTypes, "image/svg+xml"],
  });
  if (packages)
    targets.push({
      id: env.SUPABASE_STORAGE_PACKAGE_BUCKET || "packages",
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: null,
    });
  if (skills) targets.push({ id: "skill-packages", public: false, fileSizeLimit: 20 * 1024 * 1024, allowedMimeTypes: ["application/zip"] });
  if (
    targets.some(({ id }) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  )
    throw new StorageSetupError(
      "Storage bucket names must be valid and distinct.",
    );
  return targets;
}

const sameMimeTypes = (a, b) =>
  JSON.stringify([...(a || [])].sort()) ===
  JSON.stringify([...(b || [])].sort());

/** Storage API only. Never modify storage metadata with SQL or disclose raw SDK errors. */
export async function inspectStorage(storage, targets, { apply = false } = {}) {
  const listed = await storage.listBuckets();
  if (listed.error)
    throw new StorageSetupError(
      "Cannot list Storage buckets. Check the project URL and server credential.",
    );
  const results = [];
  for (const target of targets) {
    let bucket = listed.data?.find(({ id }) => id === target.id);
    if (bucket && bucket.public !== target.public) {
      results.push({
        id: target.id,
        status: "blocked",
        hint: "Bucket visibility differs; inspect its contents before changing public/private access.",
      });
      continue;
    }
    const ready =
      bucket &&
      Number(bucket.file_size_limit) === target.fileSizeLimit &&
      sameMimeTypes(bucket.allowed_mime_types, target.allowedMimeTypes);
    if (ready) {
      results.push({
        id: target.id,
        status: "ready",
        hint: "Visibility and upload restrictions match.",
      });
      continue;
    }
    if (!apply) {
      results.push({
        id: target.id,
        status: bucket ? "incomplete" : "missing",
        hint: "Run with --apply to create the bucket or set upload restrictions.",
      });
      continue;
    }
    const options = {
      public: target.public,
      fileSizeLimit: target.fileSizeLimit,
      allowedMimeTypes: target.allowedMimeTypes,
    };
    const updated = bucket
      ? await storage.updateBucket(target.id, options)
      : await storage.createBucket(target.id, options);
    if (updated.error)
      throw new StorageSetupError(
        "Storage setup failed. No files were deleted; rerun the read-only check.",
      );
    const checked = await storage.getBucket(target.id);
    if (checked.error || !checked.data)
      throw new StorageSetupError(
        "Storage setup could not be verified. Rerun the read-only check.",
      );
    bucket = checked.data;
    if (
      bucket.public !== target.public ||
      Number(bucket.file_size_limit) !== target.fileSizeLimit ||
      !sameMimeTypes(bucket.allowed_mime_types, target.allowedMimeTypes)
    )
      throw new StorageSetupError(
        "Storage settings differ after setup. Inspect the bucket in Dashboard.",
      );
    results.push({
      id: target.id,
      status: "ready",
      hint: "Settings applied and verified through Storage API.",
    });
  }
  return results;
}
