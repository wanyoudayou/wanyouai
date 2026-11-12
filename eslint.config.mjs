import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
