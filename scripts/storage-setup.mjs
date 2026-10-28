import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  StorageSetupError,
  inspectStorage,
  storageTargets,
} from "../src/lib/config/storage.mjs";
export { inspectStorage, storageTargets } from "../src/lib/config/storage.mjs";

async function main() {
  if (process.argv.includes("--help")) {
    console.log(
      "npm run storage:setup -- [--apply] [--skills] [--packages]\nDefault: read-only check for the public media bucket and private media-uploads staging bucket. --skills also checks skill-packages; --packages is only for the legacy package bucket.\nLoads .env.local; uses the server credential; prints no credentials. Does not create object RLS policies or upload files.",
    );
    return;
  }
  if (
    process.argv
      .slice(2)
      .some((arg) => !["--apply", "--packages", "--skills"].includes(arg))
  )
    throw new StorageSetupError("Unknown argument; use --help.");
  if (existsSync(".env.local")) loadEnvFile(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new StorageSetupError(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your server environment.",
    );
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol))
      throw new StorageSetupError();
  } catch {
    throw new StorageSetupError("Invalid Supabase project URL.");
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
  const results = await inspectStorage(
    client.storage,
    storageTargets(process.env, {
      packages: process.argv.includes("--packages"),
      skills: process.argv.includes("--skills"),
    }),
    { apply: process.argv.includes("--apply") },
  );
  for (const { id, status, hint } of results)
    console.log(`${status.padEnd(10)} ${id}: ${hint}`);
  console.log(
    "Object RLS policies require a separate database check; bucket settings alone do not verify write permissions.",
  );
  if (results.some(({ status }) => status !== "ready")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    // Errors from network/env loading can contain credentials or local paths.
    console.error(
      error instanceof StorageSetupError
        ? error.message
        : "Storage operation failed. Check environment, network and bucket settings; no files were deleted. Use --help for options.",
    );
    process.exitCode = 1;
  });
