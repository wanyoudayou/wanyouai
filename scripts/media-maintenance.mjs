import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { prepareImageUpload } from "../src/lib/publishing/upload.ts";
import { mediaStoragePath } from "../src/lib/publishing/media-url.ts";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "npm run media:maintain -- --index [--apply]\nnpm run media:maintain -- --cleanup-staging [--apply]\nLoads .env.local. Default is read-only. Index validates existing public images without rewriting their addresses. Cleanup removes only private staging objects expired more than 24 hours ago; never public images or upload records.",
  );
} else {
  try {
    if (
      args.some(
        (arg) => !["--index", "--cleanup-staging", "--apply"].includes(arg),
      ) ||
      args.includes("--index") === args.includes("--cleanup-staging")
    )
      throw new Error("Use --help for options.");
    if (existsSync(".env.local")) loadEnvFile(".env.local");
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY
    )
      throw new Error("Missing server environment.");
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (url, options) =>
            fetch(url, { ...options, signal: AbortSignal.timeout(20000) }),
        },
      },
    );
    const apply = args.includes("--apply");
    let inspected = 0,
      changed = 0,
      rejected = 0;
    if (args.includes("--index")) {
      const bucket = db.storage.from(
        process.env.SUPABASE_STORAGE_MEDIA_BUCKET || "media",
      );
      async function* entries(prefix) {
        for (let offset = 0; ; offset += 100) {
          const result = await bucket.list(prefix, {
            limit: 100,
            offset,
            sortBy: { column: "name", order: "asc" },
          });
          if (result.error) throw new Error("Storage listing unavailable.");
          yield* result.data;
          if (result.data.length < 100) break;
        }
      }
      for await (const folder of entries("media")) {
        if (folder.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folder.name))
          continue;
        for await (const file of entries(`media/${folder.name}`)) {
          const path = mediaStoragePath(folder.name, file.name);
          if (!file.id || !path) continue;
          inspected++;
          const known = await db
            .from("media_assets")
            .select("id")
            .eq("storage_path", path)
            .maybeSingle();
          if (known.error)
            throw new Error(
              "Catalog unavailable; apply the database upgrade first.",
            );
          if (known.data) continue;
          if (!apply) {
            changed++;
            continue;
          }
          try {
            const stored = await bucket.download(path);
            if (stored.error || !stored.data || stored.data.size > 10485760)
              throw new Error();
            const bytes = new Uint8Array(await stored.data.arrayBuffer());
            const mime = {
              png: "image/png",
              jpg: "image/jpeg",
              webp: "image/webp",
              gif: "image/gif",
            }[file.name.split(".").pop()];
            const prepared = await prepareImageUpload(
              bytes,
              mime,
              folder.name,
              file.name,
            );
            if (
              prepared.media.storage_path !== path ||
              createHash("sha256").update(bytes).digest("hex") !==
                prepared.media.sha256
            )
              throw new Error();
            const { storage_path, sha256, mime_type, width, height } =
              prepared.media;
            const media = { storage_path, sha256, mime_type, width, height };
            const inserted = await db.from("media_assets").upsert(
              {
                ...media,
                byte_size: bytes.byteLength,
                name: `${folder.name} · ${file.name.slice(0, 12)}`,
              },
              { onConflict: "storage_path", ignoreDuplicates: true },
            );
            if (inserted.error) throw new Error();
            changed++;
          } catch {
            rejected++;
          }
        }
        console.log(
          `Progress: ${inspected} images inspected; ${changed} ${apply ? "indexed" : "not yet indexed"}; ${rejected} rejected.`,
        );
      }
    } else {
      const cutoff = new Date(Date.now() - 86400000).toISOString();
      let cursor = "00000000-0000-0000-0000-000000000000";
      for (;;) {
        const result = await db
          .from("media_uploads")
          .select("id,owner_id")
          .lt("expires_at", cutoff)
          .gt("id", cursor)
          .order("id")
          .limit(100);
        if (result.error) throw new Error("Upload records unavailable.");
        if (!result.data.length) break;
        inspected += result.data.length;
        if (apply) {
          const removed = await db.storage
            .from("media-uploads")
            .remove(result.data.map((row) => `${row.owner_id}/${row.id}`));
          if (removed.error) throw new Error("Staging cleanup unavailable.");
          changed += removed.data?.length ?? 0;
        }
        cursor = result.data.at(-1).id;
      }
    }
    console.log(
      `${apply ? "Applied" : "Read-only"}: inspected=${inspected}, changed=${changed}, rejected=${rejected}. No public files were deleted or rewritten.`,
    );
    if (rejected) process.exitCode = 1;
  } catch {
    console.error(
      "Media maintenance failed. Check server configuration, schema, Storage and network; use --help. No credentials are printed.",
    );
    process.exitCode = 1;
  }
}
