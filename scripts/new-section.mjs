// Scaffold or remove a code section. Used by the local `new-section` skill.
//   node scripts/new-section.mjs new <name> --title "标题" --description "说明" [--icon flask] [--tier standard|extended]
//   node scripts/new-section.mjs remove <name>
// Both commands regenerate the registry; they never edit package.json, commit or deploy.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const template = path.join(root, "scripts/templates/section");
const NAME = /^[a-z][a-z0-9-]{1,39}$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function option(args, key, fallback) {
  const index = args.indexOf(`--${key}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
}

function icons() {
  const source = readFileSync(path.join(root, "src/lib/navigation/icons.ts"), "utf8");
  const block = /NAV_ICONS\s*=\s*\{([\s\S]*?)\}\s*satisfies/.exec(source)?.[1] ?? "";
  return [...block.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?\s*:/gm)].map((match) => match[1]);
}

function render(file, values) {
  let text = readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`__${key}__`, value);
  return text;
}

function files(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files(full, output);
    else output.push(full);
  }
  return output;
}

function build() {
  execFileSync(process.execPath, [path.join(root, "scripts/build-sections.mjs")], { cwd: root, stdio: "inherit" });
}

const [command, name, ...args] = process.argv.slice(2);
if (!["new", "remove"].includes(command) || !name) fail("Usage: new-section.mjs new|remove <name> [options]");
if (!NAME.test(name)) fail("栏目名称需以小写字母开头，只含小写字母、数字和短横线（2–40 位）。");
const sectionDir = path.join(root, "src/sections", name);
const routeDir = path.join(root, "src/app/lab", name);

if (command === "new") {
  if (existsSync(sectionDir) || existsSync(routeDir)) fail(`栏目 ${name} 已存在。`);
  const tier = option(args, "tier", "standard");
  const icon = option(args, "icon", "flask");
  const title = option(args, "title", "");
  const description = option(args, "description", "");
  if (!["standard", "extended"].includes(tier)) fail("--tier 只能是 standard 或 extended。");
  if (!icons().includes(icon)) fail(`图标 ${icon} 不在 src/lib/navigation/icons.ts 白名单中：${icons().join(", ")}`);
  if (!title || [...title].length > 40) fail("请用 --title 提供 40 字以内的标题。");
  if (!description || [...description].length > 200) fail("请用 --description 提供 200 字以内的说明。");
  const values = { NAME: name, TITLE: title, DESCRIPTION: description, ICON: icon, TIER: tier };
  for (const file of files(template)) {
    const relative = path.relative(template, file).replace(/\.tpl$/, "");
    if (relative === "route.tsx" || (relative === "tokens.json" && tier !== "extended")) continue;
    const target = path.join(sectionDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, render(file, values));
  }
  let route = render(path.join(template, "route.tsx.tpl"), values);
  if (tier === "extended") route = `import "@/generated/sections/${name}.tokens.css";\n${route}`;
  mkdirSync(path.join(routeDir, "[[...rest]]"), { recursive: true });
  writeFileSync(path.join(routeDir, "[[...rest]]", "page.tsx"), route);
  build();
  console.log(`Created src/sections/${name} and /lab/${name}. Add it in /admin/navigation after deployment.`);
} else {
  if (!existsSync(sectionDir) && !existsSync(routeDir)) fail(`栏目 ${name} 不存在。`);
  let owned = [];
  try {
    owned = JSON.parse(readFileSync(path.join(sectionDir, "manifest.json"), "utf8")).dependencies ?? [];
  } catch {
    /* manifest already gone */
  }
  rmSync(sectionDir, { recursive: true, force: true });
  rmSync(routeDir, { recursive: true, force: true });
  if (existsSync(path.join(root, "src/app/lab")) && !readdirSync(path.join(root, "src/app/lab")).length)
    rmSync(path.join(root, "src/app/lab"), { recursive: true });
  if (owned.length) {
    console.log(`Section ${name} owned: ${owned.join(", ")}. Remove them before committing:\n  npm uninstall ${owned.join(" ")}`);
    console.log("Registry not rebuilt yet: run npm run sections:build after uninstalling.");
  } else build();
  console.log(`Removed src/sections/${name} and /lab/${name}. Delete its entry in /admin/navigation after deployment.`);
}
