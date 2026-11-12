// Code sections registry and guards.
//   npm run sections:build   regenerate src/generated/sections.json and section token CSS
//   npm run sections:check   fail when generated files are stale or a guard is violated
// Rules: docs/development/custom-sections.md
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;
const CODE_EXT = /\.(?:[cm]?[jt]sx?|css)$/;
const CORE_PACKAGES = new Set(["react", "react-dom", "next"]);
/** Declared only to satisfy another package's peer dependency (zod for the AI SDK). */
const PEER_ONLY = new Set(["zod"]);
/** Packages and entrypoints sections may not use even though the site depends on them. */
const DENIED_FOR_SECTIONS = [
  /^@supabase\//,
  /^ai$/,
  /^@ai-sdk\//,
  /^next\/(?:headers|script|server)$/,
  /^node:/,
];
/** The facade itself may not re-export privileged server modules. */
const DENIED_FOR_SDK = [
  /^@\/lib\/supabase\/service/,
  /^@\/lib\/payments/,
  /^@\/lib\/publishing/,
  /^@\/lib\/admin/,
  /^@\/lib\/avatar/,
  /^@\/lib\/ai/,
];
const ICON_FILE = "src/lib/navigation/icons.ts";
const CODE_ROOTS = ["src", "scripts", "tests", "packages", "plugins"];
const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", "out", "test-results", "fixture"]);

const posix = (value) => value.split(path.sep).join("/");

function walk(directory, filter, output = []) {
  if (!existsSync(directory)) return output;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) walk(path.join(directory, entry.name), filter, output);
    } else if (filter(entry.name)) output.push(path.join(directory, entry.name));
  }
  return output;
}

export function importSpecifiers(source, file) {
  const found = new Set();
  const patterns = file.endsWith(".css")
    ? [/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/g, /composes\s*:[^;]*?from\s+["']([^"']+)["']/g]
    : [
        /(?:^|[^\w$.])(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?["']([^"']+)["']/g,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
        /\brequire\(\s*["']([^"']+)["']\s*\)/g,
      ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

export function packageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("@/")) return null;
  if (/^[a-z]+:/.test(specifier) && !specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function hexToRgb(value) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

export function contrastRatio(foreground, background) {
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = hexToRgb(foreground), b = hexToRgb(background);
  if (!a || !b) return null;
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const TOKEN_VALUE = /^[#a-zA-Z0-9(),.%\s+\-/*]{1,200}$/;

function sectionTokens(name, tokens, errors) {
  const where = `src/sections/${name}/tokens.json`;
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
    errors.push(`${where}: 需为对象 { light, dark, contrast? }`);
    return null;
  }
  const { light, dark, contrast = [] } = tokens;
  const unknown = Object.keys(tokens).filter((key) => !["light", "dark", "contrast"].includes(key));
  if (unknown.length) errors.push(`${where}: 不支持的字段 ${unknown.join(", ")}`);
  for (const [theme, values] of [["light", light], ["dark", dark]]) {
    if (!values || typeof values !== "object" || Array.isArray(values) || !Object.keys(values).length) {
      errors.push(`${where}: 缺少 ${theme} 主题的变量`);
      return null;
    }
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith(`--${name}-`) || !/^--[a-z0-9-]+$/.test(key))
        errors.push(`${where}: 变量 ${key} 必须以 --${name}- 开头，只含小写字母、数字和短横线`);
      if (typeof value !== "string" || !TOKEN_VALUE.test(value) || /url\(|expression\(/i.test(value))
        errors.push(`${where}: 变量 ${key} 的值无效`);
    }
  }
  const lightKeys = Object.keys(light).sort().join(","), darkKeys = Object.keys(dark).sort().join(",");
  if (lightKeys !== darkKeys) errors.push(`${where}: 浅色与深色主题必须定义同一组变量`);
  if (!Array.isArray(contrast)) errors.push(`${where}: contrast 需为数组`);
  else
    for (const pair of contrast) {
      const min = pair?.min ?? 4.5;
      for (const [theme, values] of [["light", light], ["dark", dark]]) {
        const ratio = contrastRatio(String(values[pair?.foreground] ?? ""), String(values[pair?.background] ?? ""));
        if (ratio === null) errors.push(`${where}: 对比度检查 ${pair?.foreground} / ${pair?.background} 需要两个十六进制颜色（${theme}）`);
        else if (ratio < min)
          errors.push(`${where}: ${theme} 主题 ${pair.foreground} / ${pair.background} 对比度 ${ratio.toFixed(2)} 低于 ${min}`);
      }
    }
  const block = (selector, values) =>
    `${selector} {\n${Object.entries(values).map(([key, value]) => `  ${key}: ${value};`).join("\n")}\n}`;
  const scope = `[data-section="${name}"]`;
  return [
    `/* Generated by npm run sections:build. Edit src/sections/${name}/tokens.json. */`,
    block(scope, light),
    block(`.dark ${scope}`, dark),
    `@media (prefers-color-scheme: dark) {\n${block(`:root:not(.light):not(.dark) ${scope}`, dark)}\n}`,
    "",
  ].join("\n");
}

function checkSectionSource(name, file, source, context) {
  const { errors, sectionsDir, dependencies, ownedBy, imports } = context;
  const relative = posix(path.relative(context.root, file));
  const sectionRoot = path.join(sectionsDir, name);
  if (file.endsWith(".css")) {
    if (!file.endsWith(".module.css")) errors.push(`${relative}: 栏目样式只能使用 *.module.css`);
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
    if (/:global\b|:root\b/.test(stripped)) errors.push(`${relative}: 禁止 :global / :root 等全局选择器`);
    if (/(?:^|[}\s,])(?:html|body|\*)\s*(?:[,{:[.#>~+]|$)/m.test(stripped)) errors.push(`${relative}: 禁止 html / body / * 全局选择器`);
    if (/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/.test(stripped))
      errors.push(`${relative}: 不能写字面颜色值，请使用全局 token 或 tokens.json 中的栏目变量`);
    if (/@import\s+url\(\s*["']?https?:|@font-face[\s\S]*?url\(\s*["']?https?:/i.test(stripped))
      errors.push(`${relative}: 禁止加载网络字体或远程样式`);
  } else {
    if (/^\s*["']use server["']/m.test(source)) errors.push(`${relative}: 栏目不能定义 server action`);
    if (/dangerouslySetInnerHTML/.test(source)) errors.push(`${relative}: 禁止 dangerouslySetInnerHTML`);
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) errors.push(`${relative}: 禁止 eval / new Function`);
    if (/\bprocess\.env\b/.test(source)) errors.push(`${relative}: 栏目不能读取环境变量`);
    if (/<script[\s>]/i.test(source)) errors.push(`${relative}: 禁止内联或第三方脚本`);
    if (/-\[#[0-9a-fA-F]{3,8}\]|-\[(?:rgba?|hsla?|oklch)\(/.test(source))
      errors.push(`${relative}: 不能在类名中写字面颜色值`);
  }
  for (const specifier of importSpecifiers(source, file)) {
    if (specifier.startsWith("@/")) {
      if (!(specifier === "@/sections/_sdk" || specifier.startsWith("@/sections/_sdk/") || specifier.startsWith(`@/sections/${name}/`)))
        errors.push(`${relative}: 只能通过 @/sections/_sdk 使用主站能力（${specifier}）`);
      continue;
    }
    if (specifier.startsWith(".")) {
      const target = path.resolve(path.dirname(file), specifier);
      if (target !== sectionRoot && !target.startsWith(sectionRoot + path.sep))
        errors.push(`${relative}: 相对导入不能离开栏目目录（${specifier}）`);
      continue;
    }
    const pkg = packageName(specifier);
    if (!pkg) {
      errors.push(`${relative}: 不支持的导入 ${specifier}`);
      continue;
    }
    if (DENIED_FOR_SECTIONS.some((pattern) => pattern.test(specifier)) || DENIED_FOR_SECTIONS.some((pattern) => pattern.test(pkg)))
      errors.push(`${relative}: 栏目不能直接使用 ${specifier}`);
    else if (!dependencies.has(pkg)) errors.push(`${relative}: ${pkg} 不在根 package.json dependencies 中`);
    else if (ownedBy.has(pkg) && ownedBy.get(pkg) !== name)
      errors.push(`${relative}: ${pkg} 由栏目 ${ownedBy.get(pkg)} 独占登记，不能跨栏目使用`);
    imports.add(pkg);
  }
}

/** Analyse a repository root. Pure aside from reads; returns generated files and findings. */
export function analyzeSections(root) {
  const errors = [], warnings = [];
  const sectionsDir = path.join(root, "src/sections");
  const labDir = path.join(root, "src/app/lab");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const dependencies = new Set(Object.keys(pkg.dependencies ?? {}));
  const schema = JSON.parse(readFileSync(path.join(root, "docs/contracts/section-manifest.schema.json"), "utf8"));
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  const iconSource = existsSync(path.join(root, ICON_FILE)) ? readFileSync(path.join(root, ICON_FILE), "utf8") : "";
  const iconBlock = /NAV_ICONS\s*=\s*\{([\s\S]*?)\}\s*satisfies/.exec(iconSource)?.[1] ?? "";
  const icons = new Set([...iconBlock.matchAll(/^\s*"?([a-z][a-z0-9-]*)"?\s*:/gm)].map((match) => match[1]));

  const names = existsSync(sectionsDir)
    ? readdirSync(sectionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).map((entry) => entry.name).sort()
    : [];
  const manifests = [];
  const ownedBy = new Map();
  for (const name of names) {
    const dir = path.join(sectionsDir, name);
    const where = `src/sections/${name}`;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
    } catch {
      errors.push(`${where}/manifest.json: 缺失或不是有效 JSON`);
      continue;
    }
    if (!validate(manifest)) {
      errors.push(`${where}/manifest.json: ${validate.errors.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ")}`);
      continue;
    }
    if (manifest.name !== name) errors.push(`${where}/manifest.json: name 必须与目录名 ${name} 一致`);
    if (icons.size && !icons.has(manifest.icon)) errors.push(`${where}/manifest.json: 图标 ${manifest.icon} 不在 ${ICON_FILE} 白名单中`);
    for (const required of ["page.tsx", "README.md"])
      if (!existsSync(path.join(dir, required))) errors.push(`${where}/${required}: 缺失`);
    const hasTokens = existsSync(path.join(dir, "tokens.json"));
    if (manifest.tier === "standard" && (manifest.dependencies.length || hasTokens))
      errors.push(`${where}: 标准档不能登记独占依赖或 tokens.json；需要时改为 extended`);
    for (const dependency of manifest.dependencies) {
      if (CORE_PACKAGES.has(dependency)) errors.push(`${where}: ${dependency} 由主站提供，不能登记为栏目依赖`);
      else if (!dependencies.has(dependency)) errors.push(`${where}: 依赖 ${dependency} 未写入根 package.json dependencies`);
      else if (ownedBy.has(dependency)) errors.push(`${where}: 依赖 ${dependency} 已由栏目 ${ownedBy.get(dependency)} 登记`);
      else ownedBy.set(dependency, name);
    }
    manifests.push({ manifest, hasTokens, dir });
  }

  const tokenFiles = new Map();
  const registry = [];
  for (const { manifest, hasTokens, dir } of manifests) {
    const { name } = manifest;
    const imports = new Set();
    const files = walk(dir, (file) => CODE_EXT.test(file) || file.endsWith(".json") || file.endsWith(".md"));
    for (const file of files) {
      if (!CODE_EXT.test(file)) continue;
      const base = path.basename(file);
      if (/^(?:route|middleware|proxy)\.[jt]sx?$/.test(base)) errors.push(`src/sections/${name}/${posix(path.relative(dir, file))}: 栏目不能定义路由处理器或中间件`);
      checkSectionSource(name, file, readFileSync(file, "utf8"), { root, errors, sectionsDir, dependencies, ownedBy, imports });
    }
    for (const sql of walk(dir, (file) => file.endsWith(".sql"))) errors.push(`${posix(path.relative(root, sql))}: 栏目不能包含数据库迁移`);
    for (const dependency of manifest.dependencies)
      if (!imports.has(dependency)) errors.push(`src/sections/${name}: 登记的依赖 ${dependency} 未被使用，请从 manifest 与 package.json 中移除`);
    if (hasTokens) {
      let tokens;
      try {
        tokens = JSON.parse(readFileSync(path.join(dir, "tokens.json"), "utf8"));
      } catch {
        errors.push(`src/sections/${name}/tokens.json: 不是有效 JSON`);
      }
      const css = tokens === undefined ? null : sectionTokens(name, tokens, errors);
      if (css) tokenFiles.set(`src/generated/sections/${name}.tokens.css`, css);
    }
    if (manifest.tier === "extended" && !manifest.dependencies.length && !hasTokens)
      warnings.push(`src/sections/${name}: 扩展档未使用独占依赖或栏目 token，建议改为 standard`);

    const route = path.join(labDir, name, "[[...rest]]", "page.tsx");
    if (!existsSync(route)) errors.push(`src/app/lab/${name}/[[...rest]]/page.tsx: 缺少栏目薄路由`);
    else {
      const source = readFileSync(route, "utf8");
      if (!source.includes(`renderSection("${name}"`)) errors.push(`src/app/lab/${name}/[[...rest]]/page.tsx: 必须调用 renderSection("${name}", …)`);
      if (hasTokens && !source.includes(`@/generated/sections/${name}.tokens.css`))
        errors.push(`src/app/lab/${name}/[[...rest]]/page.tsx: 需要导入 @/generated/sections/${name}.tokens.css`);
    }
    registry.push({
      name,
      title: manifest.title,
      description: manifest.description,
      icon: manifest.icon,
      tier: manifest.tier,
      path: `/lab/${name}`,
      dependencies: manifest.dependencies,
      budgetKb: manifest.budgetKb,
      tokens: hasTokens,
    });
  }

  // Routes under /lab belong to registered sections only, one thin page each.
  const registered = new Set(registry.map((entry) => entry.name));
  for (const file of walk(labDir, () => true)) {
    const relative = posix(path.relative(labDir, file));
    const [name, ...rest] = relative.split("/");
    if (!registered.has(name) && !names.includes(name)) errors.push(`src/app/lab/${relative}: 不属于任何已登记栏目`);
    else if (rest.join("/") !== "[[...rest]]/page.tsx") errors.push(`src/app/lab/${relative}: 栏目路由目录只能包含 [[...rest]]/page.tsx`);
    else {
      for (const specifier of importSpecifiers(readFileSync(file, "utf8"), file))
        if (specifier.startsWith("@/sections/") && !specifier.startsWith(`@/sections/${name}/`) && specifier !== `@/sections/${name}`)
          errors.push(`src/app/lab/${relative}: 只能导入本栏目 ${name}`);
    }
  }

  // Core code never depends on a section, and section-owned packages stay inside their owner.
  const sdkDir = path.join(sectionsDir, "_sdk");
  const allUsed = new Set();
  for (const base of CODE_ROOTS) {
    for (const file of walk(path.join(root, base), (name) => SOURCE_EXT.test(name) || name.endsWith(".css"))) {
      const relative = posix(path.relative(root, file));
      const inSection = relative.startsWith("src/sections/") && !relative.startsWith("src/sections/_sdk/");
      const source = readFileSync(file, "utf8");
      const specifiers = importSpecifiers(source, file);
      for (const specifier of specifiers) {
        const pkgName = packageName(specifier);
        if (pkgName) allUsed.add(pkgName);
        if (inSection) continue;
        if (file.startsWith(sdkDir + path.sep) && DENIED_FOR_SDK.some((pattern) => pattern.test(specifier)))
          errors.push(`${relative}: _sdk 不能导出特权模块 ${specifier}`);
        if (
          relative.startsWith("src/") &&
          specifier.startsWith("@/sections/") &&
          !specifier.startsWith("@/sections/_sdk") &&
          !relative.startsWith("src/app/lab/")
        )
          errors.push(`${relative}: 主站代码不能导入栏目（${specifier}）`);
        if (pkgName && ownedBy.has(pkgName) && !relative.startsWith("tests/"))
          errors.push(`${relative}: ${pkgName} 由栏目 ${ownedBy.get(pkgName)} 独占，主站代码不能导入`);
      }
    }
  }
  for (const config of readdirSync(root).filter((name) => /\.(?:[cm]?[jt]s)$/.test(name)))
    for (const specifier of importSpecifiers(readFileSync(path.join(root, config), "utf8"), config)) {
      const pkgName = packageName(specifier);
      if (pkgName) allUsed.add(pkgName);
    }
  for (const dependency of dependencies)
    if (!allUsed.has(dependency) && !CORE_PACKAGES.has(dependency) && !PEER_ONLY.has(dependency))
      errors.push(`package.json: 依赖 ${dependency} 没有被任何代码导入；删除栏目时请同时移除其独占依赖`);

  const generated = new Map([["src/generated/sections.json", `${JSON.stringify({ sections: registry }, null, 2)}\n`], ...tokenFiles]);
  return { errors, warnings, generated, registry };
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const rootIndex = args.indexOf("--root");
  const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]) : path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const { errors, warnings, generated, registry } = analyzeSections(root);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  const generatedDir = path.join(root, "src/generated/sections");
  const stale = [];
  for (const [file, content] of generated) {
    const target = path.join(root, file);
    const current = existsSync(target) ? readFileSync(target, "utf8") : null;
    if (current !== content) stale.push(file);
  }
  const extra = existsSync(generatedDir)
    ? readdirSync(generatedDir).map((name) => `src/generated/sections/${name}`).filter((file) => !generated.has(file))
    : [];
  if (errors.length) {
    for (const error of errors) console.error(`error: ${error}`);
    console.error(`Sections check failed: ${errors.length} problem(s).`);
    process.exit(1);
  }
  if (check) {
    if (stale.length || extra.length) {
      console.error(`Generated section files are stale: ${[...stale, ...extra].join(", ")}. Run npm run sections:build.`);
      process.exit(1);
    }
    console.log(`Sections ok: ${registry.length} registered.`);
    return;
  }
  for (const file of extra) rmSync(path.join(root, file));
  for (const [file, content] of generated) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  if (existsSync(generatedDir) && !readdirSync(generatedDir).length) rmSync(generatedDir, { recursive: true });
  console.log(`Sections built: ${registry.length} registered.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
