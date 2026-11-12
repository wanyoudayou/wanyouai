import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Code sections reach the site only through the reviewed SDK facade
  // (full guard set: scripts/build-sections.mjs, run by npm run contracts).
  {
    files: ["src/sections/**/*.{ts,tsx,js,jsx}"],
    ignores: ["src/sections/_sdk/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "^@/(?!sections/)",
              message: "栏目只能通过 @/sections/_sdk 使用主站能力。",
            },
            {
              group: ["@supabase/*", "ai", "@ai-sdk/*", "next/headers", "next/script", "next/server"],
              message: "栏目不能直接使用数据、AI 或请求上下文模块。",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".local-archive/**",
    "dist/**",
    ".codex/**",
    ".aws/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "tests/browser/fixture/.next/**",
    "tests/browser/fixture/next-env.d.ts",
    "test-results/**",
    "playwright-report/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
