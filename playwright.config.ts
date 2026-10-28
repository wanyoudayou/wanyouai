import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30000,
  // Sequential UI coverage includes cold Next.js route compilation. Keep the
  // per-test deadline strict while leaving room for the complete suite.
  globalTimeout: 8 * 60 * 1000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3102",
    headless: true,
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node tests/browser/prepare-fixture.mjs && next dev tests/browser/fixture --webpack --hostname 127.0.0.1 --port 3102",
    url: "http://127.0.0.1:3102",
    timeout: 60000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      SITE_URL: "http://127.0.0.1:3102",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "browser-fixture-only",
      SUPABASE_SERVICE_ROLE_KEY: "browser-fixture-only",
    },
  },
});
