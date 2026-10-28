import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { inspectConfig } from "./config-registry.mjs";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const checks = inspectConfig(process.env, { existingSite: process.argv.includes("--existing-site") });
const healthy = checks.every((check) => ["ready", "disabled", "skipped"].includes(check.status));

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ healthy, checks }, null, 2)}\n`);
} else {
  for (const { id, status, hint } of checks) console.log(`${status.padEnd(10)} ${id}: ${hint}`);
  console.log(healthy ? "配置预检通过（Dashboard、远程连接和真实邮件仍需人工验证）。" : "配置预检未通过；请修正 error / incomplete 项。");
}
if (!healthy) process.exitCode = 1;
