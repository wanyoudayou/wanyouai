import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSections, contrastRatio, importSpecifiers, packageName } from "../scripts/build-sections.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));

function fixture(files, dependencies = { react: "19.0.0", next: "16.0.0", "lucide-react": "1.0.0" }) {
  const root = mkdtempSync(path.join(tmpdir(), "sections-"));
  for (const file of ["docs/contracts/section-manifest.schema.json", "src/lib/navigation/icons.ts"]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(root, file));
  }
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies }));
  // Every declared dependency is used somewhere in core code.
  mkdirSync(path.join(root, "src/lib"), { recursive: true });
  writeFileSync(
    path.join(root, "src/lib/uses.ts"),
    Object.keys(dependencies).filter((name) => !files.__owned?.includes(name)).map((name) => `import "${name}";`).join("\n"),
  );
  for (const [file, content] of Object.entries(files)) {
    if (file === "__owned") continue;
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content));
  }
  return root;
}

const manifest = (name, extra = {}) => ({
  name,
  title: "演示栏目",
  description: "用于回归测试的栏目。",
  icon: "flask",
  tier: "standard",
  dependencies: [],
  budgetKb: 100,
  ...extra,
});
const route = (name, tokens = false) =>
  `${tokens ? `import "@/generated/sections/${name}.tokens.css";\n` : ""}import Root from "@/sections/${name}/page";\nimport { renderSection } from "@/lib/sections/route";\nexport default function Page(props) { return renderSection("${name}", Root, props); }\n`;
const standard = (name, page = `import { Button } from "@/sections/_sdk";\nimport styles from "./styles.module.css";\nexport default function Root() { return <Button className={styles.root}>ok</Button>; }\n`) => ({
  [`src/sections/${name}/manifest.json`]: manifest(name),
  [`src/sections/${name}/page.tsx`]: page,
  [`src/sections/${name}/README.md`]: "# demo\n",
  [`src/sections/${name}/styles.module.css`]: ".root { color: var(--primary); }\n",
  [`src/app/lab/${name}/[[...rest]]/page.tsx`]: route(name),
});

function run(files, dependencies) {
  const root = fixture(files, dependencies);
  try {
    return analyzeSections(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("import scanner reads static, dynamic, type and CSS imports", () => {
  assert.deepEqual(
    importSpecifiers(`import a from "a";\nimport type { B } from "@b/c/d";\nexport * from "./e";\nconst f = await import("f");\nimport "g";`, "x.ts").sort(),
    ["./e", "@b/c/d", "a", "f", "g"],
  );
  assert.deepEqual(importSpecifiers(`@import "./x.css";\n.a { composes: b from "./y.module.css"; }`, "x.css"), ["./x.css", "./y.module.css"]);
  assert.equal(packageName("@scope/pkg/sub"), "@scope/pkg");
  assert.equal(packageName("next/link"), "next");
  assert.equal(packageName("@/sections/_sdk"), null);
  assert.ok(contrastRatio("#000000", "#ffffff") > 20);
  assert.equal(contrastRatio("var(--x)", "#ffffff"), null);
});

test("a standard section builds a public registry entry", () => {
  const result = run(standard("demo-lab"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.registry, [
    {
      name: "demo-lab",
      title: "演示栏目",
      description: "用于回归测试的栏目。",
      icon: "flask",
      tier: "standard",
      path: "/lab/demo-lab",
      dependencies: [],
      budgetKb: 100,
      tokens: false,
    },
  ]);
  assert.match(result.generated.get("src/generated/sections.json"), /"demo-lab"/);
});

test("section code is limited to the SDK, its own directory and declared packages", () => {
  const page = `import { createSupabaseServerClient } from "@/lib/supabase/server";
import other from "../other-lab/page";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import missing from "left-pad";
export default function Root() { const k = process.env.SECRET; eval("1"); return <div className="bg-[#ff0000]" dangerouslySetInnerHTML={{ __html: k }} />; }
`;
  const { errors } = run({ ...standard("demo-lab", page), ...standard("other-lab") });
  for (const expected of [
    /只能通过 @\/sections\/_sdk/,
    /相对导入不能离开栏目目录/,
    /不能直接使用 @supabase\/supabase-js/,
    /不能直接使用 next\/headers/,
    /left-pad 不在根 package.json/,
    /不能读取环境变量/,
    /eval/,
    /dangerouslySetInnerHTML/,
    /类名中写字面颜色值/,
  ])
    assert.ok(errors.some((error) => expected.test(error)), `${expected} not in ${errors.join("\n")}`);
});

test("styles stay scoped and use tokens", () => {
  const files = standard("demo-lab");
  files["src/sections/demo-lab/styles.module.css"] = ":global(.x) { color: #fff; }\nbody { margin: 0; }\n";
  files["src/sections/demo-lab/plain.css"] = ".a { color: var(--primary); }\n";
  const { errors } = run(files);
  for (const expected of [/:global/, /html \/ body/, /字面颜色值/, /\*\.module\.css/])
    assert.ok(errors.some((error) => expected.test(error)), `${expected} not in ${errors.join("\n")}`);
});

test("routes, manifests and server-only constructs are enforced", () => {
  const files = standard("demo-lab");
  delete files["src/app/lab/demo-lab/[[...rest]]/page.tsx"];
  files["src/sections/demo-lab/manifest.json"] = manifest("demo-lab", { icon: "unknown-icon", dependencies: ["lucide-react"] });
  files["src/sections/demo-lab/actions.ts"] = `"use server";\nexport async function a() {}\n`;
  files["src/sections/demo-lab/route.ts"] = "export function GET() {}\n";
  files["src/sections/demo-lab/schema.sql"] = "create table x();\n";
  files["src/app/lab/stray/page.tsx"] = "export default function P() { return null; }\n";
  const { errors } = run(files);
  for (const expected of [/缺少栏目薄路由/, /图标 unknown-icon/, /标准档不能登记独占依赖/, /server action/, /路由处理器/, /数据库迁移/, /不属于任何已登记栏目/])
    assert.ok(errors.some((error) => expected.test(error)), `${expected} not in ${errors.join("\n")}`);
});

test("core code cannot import sections", () => {
  const files = standard("demo-lab");
  files["src/lib/bad.ts"] = `import Root from "@/sections/demo-lab/page";\nexport { Root };\n`;
  assert.ok(run(files).errors.some((error) => /主站代码不能导入栏目/.test(error)));
});

test("extended sections own their packages and generate scoped theme tokens", () => {
  const dependencies = { react: "19.0.0", next: "16.0.0", "lucide-react": "1.0.0", "chart-lib": "1.0.0" };
  const files = {
    __owned: ["chart-lib"],
    ...standard("chart-lab", `import Chart from "chart-lib";\nexport default function Root() { return <Chart />; }\n`),
  };
  files["src/sections/chart-lab/manifest.json"] = manifest("chart-lab", { tier: "extended", dependencies: ["chart-lib"] });
  files["src/sections/chart-lab/tokens.json"] = {
    light: { "--chart-lab-ink": "#1f1d33", "--chart-lab-paper": "#ffffff" },
    dark: { "--chart-lab-ink": "#e6e3f5", "--chart-lab-paper": "#0e0c18" },
    contrast: [{ foreground: "--chart-lab-ink", background: "--chart-lab-paper" }],
  };
  files["src/app/lab/chart-lab/[[...rest]]/page.tsx"] = route("chart-lab", true);
  const ok = run(files, dependencies);
  assert.deepEqual(ok.errors, []);
  const css = ok.generated.get("src/generated/sections/chart-lab.tokens.css");
  assert.match(css, /\[data-section="chart-lab"\] \{\n {2}--chart-lab-ink: #1f1d33;/);
  assert.match(css, /\.dark \[data-section="chart-lab"\]/);
  assert.match(css, /:root:not\(\.light\):not\(\.dark\) \[data-section="chart-lab"\]/);
  assert.equal(ok.registry[0].tokens, true);

  // Core may not import a section-owned package; another section may not reuse it.
  const leaked = { ...files, "src/lib/leak.ts": `import Chart from "chart-lib";\nexport { Chart };\n` };
  assert.ok(run(leaked, dependencies).errors.some((error) => /chart-lib 由栏目 chart-lab 独占/.test(error)));
  const shared = { ...leaked, ...standard("other-lab", `import Chart from "chart-lib";\nexport default function Root() { return <Chart />; }\n`) };
  delete shared["src/lib/leak.ts"];
  assert.ok(run(shared, dependencies).errors.some((error) => /不能跨栏目使用/.test(error)));
});

test("token themes, contrast and stale ownership fail the check", () => {
  const dependencies = { react: "19.0.0", next: "16.0.0", "lucide-react": "1.0.0", "chart-lib": "1.0.0" };
  const files = { __owned: ["chart-lib"], ...standard("chart-lab") };
  files["src/sections/chart-lab/manifest.json"] = manifest("chart-lab", { tier: "extended", dependencies: ["chart-lib"] });
  files["src/sections/chart-lab/tokens.json"] = {
    light: { "--chart-lab-ink": "#cccccc", "--chart-lab-paper": "#ffffff", "--other": "red" },
    dark: { "--chart-lab-ink": "#111111" },
    contrast: [{ foreground: "--chart-lab-ink", background: "--chart-lab-paper" }],
  };
  files["src/app/lab/chart-lab/[[...rest]]/page.tsx"] = route("chart-lab", false);
  const { errors } = run(files, dependencies);
  for (const expected of [/必须以 --chart-lab- 开头/, /同一组变量/, /对比度/, /依赖 chart-lib 未被使用/, /需要导入 @\/generated\/sections\/chart-lab\.tokens\.css/])
    assert.ok(errors.some((error) => expected.test(error)), `${expected} not in ${errors.join("\n")}`);

  // A removed section leaves its package behind: the repo-wide unused check catches it.
  const orphan = run({ __owned: ["chart-lib"] }, dependencies);
  assert.ok(orphan.errors.some((error) => /依赖 chart-lib 没有被任何代码导入/.test(error)));
});

test("an extended section without its own resources is flagged for downgrade", () => {
  const files = standard("demo-lab");
  files["src/sections/demo-lab/manifest.json"] = manifest("demo-lab", { tier: "extended" });
  const result = run(files);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((warning) => /建议改为 standard/.test(warning)));
});

test("the repository registry is current", () => {
  const result = analyzeSections(repo);
  assert.deepEqual(result.errors, []);
});

test("the scaffold script creates sections that pass the guards and removes them cleanly", async () => {
  const { execFileSync } = await import("node:child_process");
  const { existsSync, readFileSync, symlinkSync } = await import("node:fs");
  const root = fixture({});
  try {
    for (const file of ["scripts/new-section.mjs", "scripts/build-sections.mjs", "scripts/templates"])
      cpSync(path.join(repo, file), path.join(root, file), { recursive: true });
    symlinkSync(path.join(repo, "node_modules"), path.join(root, "node_modules"), "dir");
    const run = (...args) => execFileSync(process.execPath, [path.join(root, "scripts/new-section.mjs"), ...args], { cwd: root, stdio: "pipe" }).toString();
    run("new", "plain-lab", "--title", "普通栏目", "--description", "标准档。", "--icon", "rocket");
    run("new", "tone-lab", "--title", "配色栏目", "--description", "扩展档。", "--icon", "chart", "--tier", "extended");
    const result = analyzeSections(root);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.registry.map((entry) => [entry.name, entry.tier, entry.tokens]), [["plain-lab", "standard", false], ["tone-lab", "extended", true]]);
    assert.match(readFileSync(path.join(root, "src/app/lab/tone-lab/[[...rest]]/page.tsx"), "utf8"), /tone-lab\.tokens\.css/);
    assert.ok(existsSync(path.join(root, "src/generated/sections/tone-lab.tokens.css")));
    assert.throws(() => run("new", "plain-lab", "--title", "x", "--description", "y"), /已存在/);
    assert.throws(() => run("new", "Bad_Name", "--title", "x", "--description", "y"));
    assert.throws(() => run("new", "icon-lab", "--title", "x", "--description", "y", "--icon", "nope"));
    run("remove", "tone-lab");
    run("remove", "plain-lab");
    assert.ok(!existsSync(path.join(root, "src/sections/tone-lab")) && !existsSync(path.join(root, "src/app/lab")));
    assert.ok(!existsSync(path.join(root, "src/generated/sections")));
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "src/generated/sections.json"), "utf8")), { sections: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
