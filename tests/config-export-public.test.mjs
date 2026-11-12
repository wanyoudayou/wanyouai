import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { findLeaks, listSections, stripSections } from "../scripts/export-public.mjs";

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "export-public-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), typeof content === "string" ? content : JSON.stringify(content, null, 2));
  }
  return root;
}

const manifest = (name, dependencies = []) => ({ name, title: "栏目", description: "说明", icon: "flask", tier: dependencies.length ? "extended" : "standard", dependencies, budgetKb: 100 });

test("export removes every section, its route, tokens, browser tests and owned packages", () => {
  const root = tree({
    "package.json": { name: "site", dependencies: { react: "19.0.0", "lucide-react": "1.0.0", "fancy-chart": "2.0.0" } },
    "src/sections/_sdk/index.ts": 'export { Button } from "@/components/ui/button";\n',
    "src/sections/demo/manifest.json": manifest("demo"),
    "src/sections/demo/page.tsx": "export default function Demo() { return null; }\n",
    "src/sections/charts/manifest.json": manifest("charts", ["fancy-chart"]),
    "src/sections/charts/page.tsx": 'import "fancy-chart";\n',
    "src/app/lab/demo/[[...rest]]/page.tsx": 'import Root from "@/sections/demo/page";\n',
    "src/app/lab/charts/[[...rest]]/page.tsx": 'import "@/generated/sections/charts.tokens.css";\n',
    "src/generated/sections/charts.tokens.css": "[data-section=\"charts\"] {}\n",
    "tests/browser/section-demo.spec.ts": 'test("demo", async ({ page }) => page.goto("/lab/demo"));\n',
    "tests/browser/fixture/app/lab/demo/[[...rest]]/page.tsx": 'import Root from "@/sections/demo/page";\n',
    "tests/browser/fixture/app/lab/fixture-lab/[[...rest]]/page.tsx": "export default function Lab() { return null; }\n",
    "tests/browser/navigation.spec.ts": "// unrelated\n",
    "src/lib/keep.ts": "export const keep = 1;\n",
  });
  try {
    assert.deepEqual(listSections(root), { names: ["charts", "demo"], packages: ["fancy-chart"] });
    const result = stripSections(root);
    assert.deepEqual(result.names, ["charts", "demo"]);
    assert.deepEqual(result.packages, ["fancy-chart"]);
    for (const gone of ["src/sections/demo", "src/sections/charts", "src/app/lab", "src/generated/sections", "tests/browser/section-demo.spec.ts", "tests/browser/fixture/app/lab/demo"])
      assert.equal(existsSync(path.join(root, gone)), false, gone);
    for (const kept of ["src/sections/_sdk/index.ts", "tests/browser/navigation.spec.ts", "src/lib/keep.ts", "tests/browser/fixture/app/lab/fixture-lab"])
      assert.equal(existsSync(path.join(root, kept)), true, kept);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    assert.deepEqual(Object.keys(pkg.dependencies), ["react", "lucide-react"]);
    assert.deepEqual(findLeaks(root, result.names, result.packages), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export reports references to removed sections that remain elsewhere", () => {
  const root = tree({
    "package.json": { name: "site", dependencies: { react: "19.0.0" } },
    "src/sections/demo/manifest.json": manifest("demo", ["fancy-chart"]),
    "docs/notes.md": "See /lab/demo for the walkthrough.\n",
    "src/lib/chart.ts": 'import "fancy-chart";\n',
    "src/lib/other.ts": 'export const href = "/lab/demo-two";\n',
  });
  try {
    const { names, packages } = stripSections(root);
    assert.deepEqual(findLeaks(root, names, packages).sort(), ["docs/notes.md: 栏目 demo", "src/lib/chart.ts: 依赖 fancy-chart"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("export of a tree without sections changes nothing", () => {
  const root = tree({ "package.json": { name: "site", dependencies: { react: "19.0.0" } }, "src/sections/_sdk/index.ts": "export {};\n" });
  try {
    assert.deepEqual(stripSections(root), { names: [], packages: [], removed: [] });
    assert.equal(existsSync(path.join(root, "src/sections/_sdk/index.ts")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
