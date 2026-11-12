import test from "node:test";
import assert from "node:assert/strict";
import { inspectStorage, storageTargets } from "../scripts/storage-setup.mjs";

function mockStorage(initial = []) {
  const buckets = new Map(initial.map((row) => [row.id, row]));
  const writes = [];
  const save = async (id, options) => {
    writes.push(id);
    buckets.set(id, {
      id,
      public: options.public,
      file_size_limit: options.fileSizeLimit,
      allowed_mime_types: options.allowedMimeTypes,
    });
    return { error: null };
  };
  return {
    writes,
    api: {
      listBuckets: async () => ({ data: [...buckets.values()] }),
      getBucket: async (id) => ({ data: buckets.get(id) }),
      createBucket: save,
      updateBucket: save,
    },
  };
}

test("Storage preflight is read-only; setup verifies settings and becomes idempotent", async () => {
  const target = storageTargets({});
  const storage = mockStorage();
  assert.equal(
    (await inspectStorage(storage.api, target))[0].status,
    "missing",
  );
  assert.deepEqual(storage.writes, []);
  assert.equal(
    (await inspectStorage(storage.api, target, { apply: true }))[0].status,
    "ready",
  );
  assert.equal(
    (await inspectStorage(storage.api, target, { apply: true }))[0].status,
    "ready",
  );
  assert.deepEqual(storage.writes, ["media", "media-uploads"]);
});

test("setup preserves visibility of existing buckets and rejects public/private name collision", async () => {
  const storage = mockStorage([
    { id: "media", public: false },
    { id: "media-uploads", public: true },
    { id: "packages", public: true },
  ]);
  const results = await inspectStorage(
    storage.api,
    storageTargets({}, { packages: true }),
    { apply: true },
  );
  assert.equal(
    results.every(({ status }) => status === "blocked"),
    true,
  );
  assert.deepEqual(storage.writes, []);
  assert.throws(
    () =>
      storageTargets(
        { SUPABASE_STORAGE_PACKAGE_BUCKET: "media" },
        { packages: true },
      ),
    /distinct/,
  );
  assert.throws(
    () => storageTargets({ SUPABASE_STORAGE_MEDIA_BUCKET: "media-uploads" }),
    /distinct/,
  );
});

test("setup narrows media uploads but does not print SDK errors or trust success without verification", async () => {
  const storage = mockStorage([
    {
      id: "media",
      public: true,
      file_size_limit: null,
      allowed_mime_types: null,
    },
  ]);
  await inspectStorage(storage.api, storageTargets({}), { apply: true });
  assert.deepEqual(storage.writes, ["media", "media-uploads"]);
  await assert.rejects(
    inspectStorage(
      { listBuckets: async () => ({ error: { message: "secret-token" } }) },
      storageTargets({}),
    ),
    (error) => !error.message.includes("secret-token"),
  );
  const broken = mockStorage();
  broken.api.getBucket = async () => ({ data: { public: false } });
  await assert.rejects(
    inspectStorage(broken.api, storageTargets({}), { apply: true }),
    /differ after setup/,
  );
});
