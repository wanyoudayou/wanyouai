import { expect, test } from "@playwright/test";
import type { KnowledgeStatus } from "../../src/lib/ai/knowledge";

for (const theme of ["light", "dark"] as const) for (const width of [320, 1440]) {
  test(`Avatar Markdown template is opt-in, reversible, and preserves raw form data (${theme}, ${width}px)`, async ({ page }, info) => {
    const writes: string[] = [];
    page.on("request", request => { if (request.method() === "POST") writes.push(new URL(request.url()).pathname); });
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/admin/ai");
    const editor = page.getByRole("group", { name: "分身指令编辑器", exact: true });
    const source = page.getByLabel("分身指令", { exact: true });
    await expect(source).toHaveValue("使用本站资料回答。");
    const original = "# 我的角色\n\n**保留这份自定义指令。**\n- 只说明已经提供的能力。";
    await source.fill(original);
    await editor.getByRole("button", { name: "载入推荐模板", exact: true }).click();
    await expect(page.getByRole("group", { name: "确认替换分身指令" })).toBeVisible();
    await expect(source).toHaveValue(original);
    await editor.getByRole("button", { name: "保留当前指令", exact: true }).click();
    await expect(source).toHaveValue(original);
    await editor.getByRole("button", { name: "载入推荐模板", exact: true }).click();
    await editor.getByRole("button", { name: "替换当前指令", exact: true }).click();
    const template = await source.inputValue();
    expect(template).toMatch(/^# 角色\n/);
    await expect(editor.getByRole("button", { name: "载入推荐模板", exact: true })).toBeDisabled();
    await expect(editor).toContainText("推荐模板已载入当前草稿，保存后生效。");
    await editor.getByRole("tab", { name: "预览", exact: true }).click();
    const preview = editor.getByRole("region", { name: "分身指令预览" });
    await expect(preview.getByRole("heading", { name: "角色", exact: true })).toBeVisible();
    const form = page.locator("form").filter({ has: page.locator('input[name="revision"]') }).first();
    expect(await form.evaluate(node => new FormData(node as HTMLFormElement).getAll("owner_instructions"))).toEqual([template]);
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await expect(preview.getByRole("heading", { name: "角色", exact: true })).toBeVisible();
    await editor.screenshot({ path: info.outputPath(`instructions-${theme}-${width}.png`) });
    await editor.getByRole("tab", { name: "编辑", exact: true }).click();
    await expect(source).toHaveValue(template);
    await editor.getByRole("button", { name: "撤销载入", exact: true }).click();
    await expect(source).toHaveValue(original);
    expect(await form.evaluate(node => new FormData(node as HTMLFormElement).get("owner_instructions"))).toBe(original);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("An empty instruction can load a template directly and undo to empty without saving", async ({ page }) => {
  await page.goto("/admin/ai");
  const source = page.getByLabel("分身指令", { exact: true });
  await source.fill("");
  await page.getByRole("button", { name: "载入推荐模板", exact: true }).click();
  await expect(page.getByRole("group", { name: "确认替换分身指令" })).toHaveCount(0);
  await expect(source).toHaveValue(/^# 角色\n/);
  await page.getByRole("button", { name: "撤销载入", exact: true }).click();
  await expect(source).toHaveValue("");
});

test("Instruction preview renders Markdown without executing HTML or requesting images", async ({ page }) => {
  const images: string[] = [];
  page.on("request", request => { if (request.url().includes("instruction-image.example.test")) images.push(request.url()); });
  await page.goto("/admin/ai");
  const raw = '# 角色\n\n**结构化指令**\n\n![不应加载](https://instruction-image.example.test/private.png)\n\n<script>window.instructionPreviewExecuted=true</script>';
  await page.getByLabel("分身指令", { exact: true }).fill(raw);
  await page.getByRole("tab", { name: "预览", exact: true }).click();
  const preview = page.getByRole("region", { name: "分身指令预览" });
  await expect(preview.getByRole("heading", { name: "角色", exact: true })).toBeVisible();
  await expect(preview.locator("strong")).toHaveText("结构化指令");
  await expect(preview.getByRole("img")).toHaveCount(0);
  expect(images).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { instructionPreviewExecuted?: boolean }).instructionPreviewExecuted)).toBeUndefined();
  const form = page.locator("form").filter({ has: page.locator('input[name="revision"]') }).first();
  expect(await form.evaluate(node => new FormData(node as HTMLFormElement).get("owner_instructions"))).toBe(raw);
});

for (const theme of ["light", "dark"] as const) for (const width of [320, 1440]) {
  test(`AI settings: explicit consent and retained fields at ${width}px in ${theme}`, async ({ page }, info) => {
    const errors: string[] = []; const probes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (/hydration|didn't match/i.test(message.text())) errors.push(message.text()); });
    page.on("request", request => { if (/\/api\/admin\/ai\/check/.test(request.url())) probes.push(request.url()); });
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/admin/ai");
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    await page.getByLabel("配置生成连接", { exact: true }).check();
    await page.getByLabel("模型标识", { exact: true }).fill("synthetic-test-model");
    await page.getByLabel("生成 API Key", { exact: true }).fill("synthetic-fixture-key");
    await page.getByLabel("分身指令", { exact: true }).fill("切换主题后保留此指令。");
    await expect(page.getByRole("button", { name: "检查生成连接", exact: true })).toBeDisabled();
    await expect(page.getByText("状态未读取或暂不可用，不能据此判断已完成。", { exact: true })).toBeVisible();
    if (width === 1440) for (let step = 0; step < 3; step++) await page.getByRole("button", { name: /^外观：/ }).click();
    await expect(page.getByLabel("模型标识", { exact: true })).toHaveValue("synthetic-test-model");
    await expect(page.getByLabel("分身指令", { exact: true })).toHaveValue("切换主题后保留此指令。");
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    else await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: info.outputPath(`ai-${theme}-${width}.png`), fullPage: true });
    expect(errors).toEqual([]); expect(probes).toEqual([]);
  });
}

const saved = (): KnowledgeStatus => ({
  sourceRevision: 8, selectedConnection: "00000000-0000-4000-8000-000000000003", activeGeneration: null,
  sourceCount: 16, sourceBytes: 48000, generationCount: 1, evaluations: [],
  generations: [{ id: "00000000-0000-4000-8000-000000000004", connectionId: "00000000-0000-4000-8000-000000000003", state: "building", scanCursor: "", scanComplete: true, approvedRevision: 8,
    providerAttempts: 3, threshold: null, evaluatedRevision: null, evaluation: null, mode: "initialize", reusedItems: 0,
    counts: { total: 36, ready: 36, pending: 0, leased: 0, failed: 0, obsolete: 0 } }],
});
for (const theme of ["light", "dark"] as const) for (const width of [320, 1440]) {
  test(`Completed knowledge workflow at ${width}px in ${theme} resumes at evaluation without paid calls`, async ({ page }, info) => {
    const writes: string[] = [];
    await page.route("**/api/admin/ai/index**", async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== "GET") writes.push(route.request().postData() ?? "");
      await route.fulfill({ json: url.searchParams.get("resource") === "sources" ? { sources: [{ target: "article:getting-started-overview", title: "产品定位与能力" }] } : { status: saved() } });
    });
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/admin/ai?fixture=ready");
    await expect(page.getByText("已保存 36/36 个向量片段", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "继续建立索引", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "确认并仅重试失败项", exact: true })).toHaveCount(0);
    await expect(page.locator('[aria-current="step"]')).toContainText("4．确认启用");
    await page.getByText("可选：检查检索效果", { exact: true }).click();
    await expect(page.getByText("准备你关心的真实问题", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "使用指南问题作为起点", exact: true })).not.toBeVisible();
    await page.getByText("可选：用使用指南问题作为起点", { exact: true }).click();
    await page.getByRole("button", { name: "使用指南问题作为起点", exact: true }).click();
    await expect(page.getByLabel("问题 1 内容", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeDisabled();
    await expect(page.getByText(/已确认 0\/40/)).toBeVisible();
    await page.getByLabel("问题 1 内容", { exact: true }).fill("修改后的问题");
    await expect(page.getByRole("button", { name: "确认并开始检查", exact: true })).toHaveCount(0);
    if (width === 1440) for (let step = 0; step < 3; step++) await page.getByRole("button", { name: /^外观：/ }).click();
    await expect(page.getByLabel("问题 1 内容", { exact: true })).toHaveValue("修改后的问题");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.screenshot({ path: info.outputPath(`knowledge-${theme}-${width}.png`), fullPage: true });
    page.once("dialog", dialog => dialog.accept());
    await page.reload();
    await expect(page.locator('[aria-current="step"]')).toContainText("4．确认启用");
    expect(writes).toEqual([]);
  });
}

test("Connection probe gives local progress and keeps the save label; unknown results are not retried", async ({ page }) => {
  let release!: () => void; let calls = 0;
  const done = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/ai/index**", route => route.fulfill({ json: { status: saved() } }));
  await page.route("**/api/admin/ai/check", async route => { calls++; await done; await route.fulfill({ status: 502, json: { message: "供应商拒绝了 API Key，请核对该供应商的 Key 后重新保存。" } }); });
  await page.goto("/admin/ai?fixture=ready");
  await page.getByText("模型连接与分身设置", { exact: false }).first().click();
  await page.getByLabel(/允许本次向供应商发送固定合成测试文字/).check();
  await page.getByRole("button", { name: "检查向量连接", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在检查向量连接…", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存全部 AI 配置", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "正在保存…", exact: true })).toHaveCount(0);
  release();
  await expect(page.getByText("供应商拒绝了 API Key，请核对该供应商的 Key 后重新保存。", { exact: true })).toBeVisible();
  expect(calls).toBe(1);
});

test("Explicit resume saves progress and moves to evaluation; reload reads without dispatching", async ({ page }) => {
  const status = saved(); status.generations[0].counts.ready = 20; status.generations[0].counts.pending = 16;
  const actions: string[] = [];
  await page.route("**/api/admin/ai/index**", async route => {
    if (new URL(route.request().url()).searchParams.get("resource") === "sources") return route.fulfill({ json: { sources: [] } });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); actions.push(body.action);
      status.generations[0].counts.ready = 36; status.generations[0].counts.pending = 0;
    }
    await route.fulfill({ json: { status } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await expect(page.locator('[aria-current="step"]')).toContainText("3．建立索引");
  await page.getByRole("button", { name: "继续建立索引", exact: true }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText("4．确认启用");
  await page.reload();
  await expect(page.locator('[aria-current="step"]')).toContainText("4．确认启用");
  expect(actions).toEqual(["step"]);
});

test("Completed evaluations can be calculated and activated without repeating question embeddings", async ({ page }) => {
  const status = saved();
  const run = { id: "00000000-0000-4000-8000-000000000005", generationId: status.generations[0].id, sourceRevision: 8, state: "complete", completed: 40, total: 40, attempts: 3 };
  const actions: string[] = [];
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "sources") return route.fulfill({ json: { sources: [] } });
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: { ...run, cases: [], results: [], report: { passed: true, holdoutRecall: 1, holdoutFalsePositives: 0 }, issue: null } } });
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON().action; actions.push(action);
      if (action === "activate") { status.generations[0].state = "active"; status.activeGeneration = status.generations[0].id; }
    }
    await route.fulfill({ json: { status: { ...status, evaluations: [run] }, result: { report: { passed: true, holdoutRecall: 1, holdoutFalsePositives: 0 } } } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await expect(page.getByRole("button", { name: "确认启用这份知识库", exact: true })).toBeDisabled();
  await page.getByLabel(/我决定启用这份知识库/).check();
  await page.getByRole("button", { name: "确认启用这份知识库", exact: true }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText("5．使用与更新");
  await expect(page.getByText("当前使用的索引", { exact: true })).toBeVisible();
  await expect(page.getByText("下一步：开启分身开关并保存，访客才能看到问答入口。", { exact: true })).toBeVisible();
  expect(actions).toEqual(["activate"]);
});

test("Lost batch response stops paid work, refresh exposes uncertainty, and retry requires its own consent", async ({ page }) => {
  const status = saved(); status.generations[0].counts.ready = 20; status.generations[0].counts.pending = 16;
  let lost = true; const actions: string[] = [];
  await page.route("**/api/admin/ai/index**", async route => {
    if (new URL(route.request().url()).searchParams.get("resource") === "sources") return route.fulfill({ json: { sources: [] } });
    if (route.request().method() === "POST") {
      const action = route.request().postDataJSON().action; actions.push(action);
      if (action === "step" && lost) { lost = false; status.generations[0].counts.leased = 16; status.generations[0].counts.pending = 0; return route.abort("failed"); }
      if (action === "retry") { status.generations[0].counts.failed = 0; status.generations[0].counts.pending = 16; }
      if (action === "step") { status.generations[0].counts.pending = 0; status.generations[0].counts.ready = 36; }
    }
    await route.fulfill({ json: { status } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await page.getByRole("button", { name: "继续建立索引", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续建立索引", exact: true })).toHaveCount(0);
  expect(actions).toEqual(["step"]);
  status.generations[0].counts.leased = 0; status.generations[0].counts.failed = 16;
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认并仅重试失败项", exact: true })).toBeDisabled();
  await page.getByLabel("失败或未确认项可能已计费，手动重试可能产生重复费用。", { exact: true }).check();
  await page.getByRole("button", { name: "确认并仅重试失败项", exact: true }).click();
  await expect(page.locator('[aria-current="step"]')).toContainText("4．确认启用");
  expect(actions).toEqual(["step", "retry", "step"]);
});

test("Index text permission is reset when the selected connection changes even at the same content revision", async ({ page }) => {
  const status = saved(); status.generations = []; status.generationCount = 0;
  await page.route("**/api/admin/ai/index**", route => route.fulfill({ json: { status } }));
  await page.goto("/admin/ai?fixture=ready");
  const permission = page.getByLabel(/允许将本次需要生成向量的文字/);
  await permission.check();
  await expect(page.getByRole("button", { name: "开始建立索引", exact: true })).toBeEnabled();
  status.selectedConnection = "00000000-0000-4000-8000-000000000099";
  await page.getByRole("button", { name: "刷新状态", exact: true }).click();
  await expect(permission).not.toBeChecked();
  await expect(page.getByRole("button", { name: "开始建立索引", exact: true })).toBeDisabled();
});

test("Multiple saved checks require an explicit choice and remember it without guessing chronology or paid calls", async ({ page }) => {
  const status = saved();
  const run = { id: "11111111-0000-4000-8000-000000000001", generationId: status.generations[0].id, sourceRevision: 8, state: "complete" as const, completed: 40, total: 40, attempts: 3 };
  status.evaluations = [run, { ...run, id: "22222222-0000-4000-8000-000000000002" }];
  const reads: string[] = []; const actions: string[] = [];
  await page.route("**/api/admin/ai/index**", async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("resource") === "evaluation") {
      const id = params.get("id")!; reads.push(id);
      return route.fulfill({ json: { evaluation: { ...run, id, cases: [], results: [], report: null, issue: "KNOWLEDGE_TRAIN_RECALL_FAILED" } } });
    }
    if (route.request().method() === "POST") actions.push(route.request().postDataJSON().action);
    return route.fulfill({ json: { status } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await expect(page.getByRole("button", { name: "查看检查 22222222（40/40）", exact: true })).toBeVisible();
  expect(reads).toEqual([]);
  await page.getByRole("button", { name: "查看检查 22222222（40/40）", exact: true }).click();
  await expect(page.getByRole("heading", { name: "查看错配与遗漏，启用由你决定", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "查看错配与遗漏，启用由你决定", exact: true })).toBeVisible();
  expect(reads).toEqual([status.evaluations[1].id, status.evaluations[1].id]);
  expect(actions).toEqual([]);
});

for (const width of [320, 1440]) test(`Failed saved check has one repair path, no reload step or accidental paid rerun at ${width}px`, async ({ page }, info) => {
  const { KNOWLEDGE_EVALUATION_EXAMPLE } = await import("../../src/lib/ai/evaluation-example");
  const status = saved();
  const run = { id: "00000000-0000-4000-8000-000000000005", generationId: status.generations[0].id, sourceRevision: 8, state: "complete" as const, completed: 40, total: 40, attempts: 3 };
  status.evaluations = [run];
  const detail = { ...run, cases: KNOWLEDGE_EVALUATION_EXAMPLE, results: KNOWLEDGE_EVALUATION_EXAMPLE.map((item, index) => [{ target: index === 3 ? "article:wrong" : item.expected[0] ?? "article:wrong", score: .7 }]), report: null, issue: "KNOWLEDGE_TRAIN_RECALL_FAILED", sourceTitles: { "article:getting-started-preparation": "部署准备" } };
  const actions: string[] = []; const dialogs: string[] = [];
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: detail } });
    if (resource === "sources") return route.fulfill({ json: { sources: [{ target: "article:getting-started-preparation", title: "部署准备" }] } });
    if (route.request().method() === "POST") actions.push(route.request().postDataJSON().action);
    return route.fulfill({ json: { status } });
  });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto("/admin/ai?fixture=ready");
  await expect(page.getByRole("heading", { name: "查看错配与遗漏，启用由你决定", exact: true })).toBeVisible();
  await expect(page.getByText("需要核对 1 个问题", { exact: true })).toBeVisible();
  await expect(page.getByText("你指定的答案来源：部署准备", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始检索验收", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "载入这次验收的问题", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("问题 1 内容", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "开始建立索引", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`failed-check-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "修改问题 4", exact: true }).click();
  await expect(page.getByLabel("问题 4 内容", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeDisabled();
  await page.getByLabel("问题 4 内容", { exact: true }).fill("部署时如何填写两个项目的配置？");
  await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeDisabled();
  await page.getByLabel("问题 4 预期来源", { exact: true }).selectOption("article:getting-started-preparation");
  await page.getByRole("button", { name: "下一步：确认检查范围", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认并开始检查", exact: true })).toBeDisabled();
  await page.getByLabel(/允许发送这 40 个问题/).check();
  await page.getByRole("button", { name: "返回修改问题", exact: true }).click();
  await expect(page.getByLabel("问题 4 内容", { exact: true })).toHaveValue("部署时如何填写两个项目的配置？");
  await page.getByRole("button", { name: "取消编辑问题", exact: true }).click();
  await expect(page.getByRole("group", { name: "确认取消问题编辑", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃本次修改", exact: true }).click();
  await page.getByRole("button", { name: "编辑诊断问题", exact: true }).click();
  await expect(page.getByLabel("问题 4 内容", { exact: true })).toHaveValue(KNOWLEDGE_EVALUATION_EXAMPLE[3].question);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(actions).toEqual([]); expect(dialogs).toEqual([]);
});

test("Generated questions require manual answer review and hide calibration grouping", async ({ page }, info) => {
  const status = saved(); const actions: string[] = [];
  const cases = Array.from({ length: 20 }, (_, i) => ({ question: `自动生成的检查问题 ${i + 1}？`, expected: [], reviewed: false, split: "train", ...(i < 10 ? { suggestedTarget: "article:known", evidence: "本站可核对的出题依据。" } : {}) }));
  const draft = { id: "00000000-0000-4000-8000-000000000006", generation_id: status.generations[0].id, source_revision: 8, connection_id: "generation", state: "pending", manifest: [{ id: "item", target: "article:known" }], next_item: 0, cases: [] as unknown[] };
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "sources") return route.fulfill({ json: { sources: [{ target: "article:known", title: "本站文章" }] } });
    if (resource === "question_plan") return route.fulfill({ json: { plan: { sourceRevision: 8, connectionId: "00000000-0000-4000-8000-000000000099", provider: "https://api.deepseek.com", bytes: 1000, manifest: [{ id: "item", title: "本站文章", target: "article:known" }] } } });
    if (resource === "draft") return route.fulfill({ json: { draft: null } });
    if (resource === "baseline") return route.fulfill({ json: { baseline: null } });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); actions.push(body.action);
      if (body.action === "questions_step") { draft.state = "complete"; draft.cases = cases; }
      return route.fulfill({ json: { draft } });
    }
    return route.fulfill({ json: { status } });
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/admin/ai?fixture=ready");
  await page.getByText("可选：检查检索效果", { exact: true }).click();
  await expect(page.getByRole("button", { name: "生成问题草稿", exact: true })).toBeDisabled();
  await page.getByLabel(/允许按上述范围发送本站资料/).check();
  await page.getByRole("button", { name: "生成问题草稿", exact: true }).click();
  await expect(page.getByText(/已确认 0\/20/)).toBeVisible();
  await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeDisabled();
  await expect(page.getByLabel("问题 1 分组", { exact: true })).toHaveCount(0);
  for (let i = 1; i <= 10; i++) await page.getByLabel(`问题 ${i} 预期来源`, { exact: true }).selectOption("article:known");
  await page.getByRole("button", { name: "下一页问题", exact: true }).click();
  for (let i = 11; i <= 20; i++) await page.getByLabel(`问题 ${i} 预期来源`, { exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeEnabled();
  expect(actions).toEqual(["questions_start", "questions_step"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("generated-review-mobile.png"), fullPage: true });
});

test("20-question daily regression reuses the accepted set without generating questions", async ({ page }) => {
  const status = saved(); const actions: string[] = [];
  const cases = Array.from({ length: 20 }, (_, i) => ({ question: `已有问题 ${i}`, expected: i < 10 ? ["article:known"] : [], split: i % 2 ? "holdout" : "train" }));
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "baseline") return route.fulfill({ json: { baseline: { cases, threshold: .65 } } });
    if (resource === "draft") return route.fulfill({ json: { draft: null } });
    if (resource === "sources") return route.fulfill({ json: { sources: [{ target: "article:known", title: "已有文章" }] } });
    if (route.request().method() === "POST") actions.push(route.request().postDataJSON().action);
    return route.fulfill({ json: { status } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await page.getByText("可选：检查检索效果", { exact: true }).click();
  await page.getByRole("button", { name: "沿用上次问题进行回归（20 题）", exact: true }).click();
  await expect(page.getByText(/已确认 20\/20/)).toBeVisible();
  await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeEnabled();
  expect(actions).toEqual([]);
});

test("Single-answer preview has a separate cost confirmation and defaults to anonymous rights", async ({ page }) => {
  const status = saved(); const actions: Record<string, unknown>[] = [];
  const run = { id: "00000000-0000-4000-8000-000000000005", generationId: status.generations[0].id, sourceRevision: 8, state: "complete", completed: 20, total: 20, attempts: 2 };
  const cases = Array.from({ length: 20 }, (_, i) => ({ question: `预演问题 ${i}`, expected: i < 10 ? ["article:known"] : [], split: i % 2 ? "holdout" : "train" }));
  const detail = { ...run, cases, results: cases.map(item => [{ target: item.expected[0] ?? "article:outside", score: item.expected.length ? .9 : .2 }]), sourceTitles: { "article:known": "本站文章" }, issue: null, report: { policyVersion: 2, passed: true, recall: 1, hits: 10, positiveCases: 10, negativeCases: 10, falsePositives: 0, holdoutRecall: 1, holdoutFalsePositives: 0, threshold: .6 } };
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: detail } });
    if (resource === "sources") return route.fulfill({ json: { sources: [] } });
    if (route.request().method() === "POST") { actions.push(route.request().postDataJSON()); return route.fulfill({ json: { preview: { text: "当前访客只能看试读。", sources: [], generated: false } } }); }
    return route.fulfill({ json: { status: { ...status, evaluations: [run] } } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await page.getByText("查看逐题结果", { exact: true }).click();
  await page.getByRole("button", { name: "预演问题 1 的真实回答", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认并预演本题", exact: true })).toBeDisabled();
  await page.getByLabel(/允许发送这道问题及该身份可读的资料/).check();
  await page.getByRole("button", { name: "确认并预演本题", exact: true }).click();
  await expect(page.getByText("当前访客只能看试读。", { exact: true })).toBeVisible();
  expect(actions).toHaveLength(1); expect(actions[0].view).toBe("anonymous"); expect(actions[0].consent).toBe(true);
  await expect(page.getByRole("button", { name: "确认并预演本题", exact: true })).toBeDisabled();
});

for (const width of [320, 1440]) test(`Adopting a verified source preserves the original report and requires a separately confirmed new check at ${width}px`, async ({ page }, info) => {
  const status = saved(); const actions: Record<string, unknown>[] = [];
  const run = { id: "00000000-0000-4000-8000-000000000005", generationId: status.generations[0].id, sourceRevision: 8, state: "complete", completed: 40, total: 40, attempts: 3 };
  const cases = Array.from({ length: 40 }, (_, i) => ({ question: `真实用户问题 ${i + 1}？`, expected: i < 20 ? ["article:known"] : [], split: i % 2 ? "holdout" : "train" }));
  const detail = { ...run, cases, results: cases.map((item, i) => i < 6 ? [{ target: "article:alternative", score: .95 }, { target: "article:another", score: .9 }, { target: "article:third", score: .85 }] : [{ target: item.expected[0] ?? "article:outside", score: item.expected.length ? .9 : .2 }]), sourceTitles: { "article:known": "原始答案", "article:alternative": "补充答案", "article:another": "另一答案", "article:third": "第三答案" }, issue: null, report: { policyVersion: 2, passed: false, recall: .7, hits: 14, positiveCases: 20, negativeCases: 20, falsePositives: 0, holdoutRecall: .7, holdoutFalsePositives: 0, threshold: .6 } };
  const original = JSON.stringify(detail);
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: detail } });
    if (resource === "sources") return route.fulfill({ json: { sources: [{ target: "article:known", title: "原始答案" }] } });
    if (route.request().method() === "POST") {
      actions.push(route.request().postDataJSON());
      return route.fulfill({ status: 400, json: { message: "已核对新检查范围；隔离测试停止发送。" } });
    }
    return route.fulfill({ json: { status: { ...status, evaluations: [run] } } });
  });
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: width === 320 ? "dark" : "light", reducedMotion: "reduce" });
  await page.goto("/admin/ai?fixture=ready");
  const report = page.getByRole("region", { name: "检索验收结果", exact: true });
  await expect(report.getByText(/^有答案题命中.*70%/)).toBeVisible();
  const row = report.getByRole("listitem").filter({ hasText: "真实用户问题 1？" });
  await expect(row).toHaveClass(/border-warning/);
  await page.getByRole("button", { name: "将补充答案加入问题 1 的可接受来源", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已将《补充答案》加入问题 1" })).toBeVisible();
  await expect(row.getByText("已加入草稿", { exact: true })).toHaveCount(1);
  await expect(report.getByText(/^有答案题命中.*70%/)).toBeVisible();
  await page.getByRole("button", { name: "将另一答案加入问题 1 的可接受来源", exact: true }).click();
  await expect(row.getByText("已加入草稿", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "将第三答案加入问题 1 的可接受来源", exact: true })).toBeDisabled();
  expect(actions).toEqual([]);
  await page.screenshot({ path: info.outputPath(`adopted-source-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "修改问题 1", exact: true }).click();
  await expect(page.getByLabel("问题 1 内容", { exact: true })).toHaveValue(cases[0].question);
  const accepted = page.getByRole("list", { name: "问题 1 的可接受来源", exact: true });
  await expect(accepted).toContainText("原始答案"); await expect(accepted).toContainText("补充答案"); await expect(accepted).toContainText("另一答案");
  await page.getByRole("button", { name: "从问题 1 移除另一答案", exact: true }).click();
  await expect(accepted).not.toContainText("另一答案");
  await page.getByRole("button", { name: "保留草稿，核对其他检索来源", exact: true }).click();
  await page.getByRole("button", { name: "将另一答案加入问题 1 的可接受来源", exact: true }).click();
  await expect(report.getByText(/^有答案题命中.*70%/)).toBeVisible();
  await page.getByRole("button", { name: "下一步：确认检查范围", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认并开始检查", exact: true })).toBeDisabled();
  expect(actions).toEqual([]);
  await page.getByLabel(/允许发送这 40 个问题/).check();
  await page.getByRole("button", { name: "确认并开始检查", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "已核对新检查范围；隔离测试停止发送。" })).toBeVisible();
  expect(actions).toHaveLength(1); expect(actions[0].action).toBe("evaluation_start"); expect(actions[0].consent).toBe(true);
  const submitted = actions[0].cases as typeof cases;
  expect(submitted[0].question).toBe(cases[0].question);
  expect(submitted[0].expected).toEqual(["article:known", "article:alternative", "article:another"]);
  expect(JSON.stringify(detail)).toBe(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Adopting a source for an outside question rechecks the balance and does not enable the old report", async ({ page }) => {
  const status = saved(); const actions: string[] = [];
  const run = { id: "00000000-0000-4000-8000-000000000005", generationId: status.generations[0].id, sourceRevision: 8, state: "complete", completed: 20, total: 20, attempts: 2 };
  const cases = Array.from({ length: 20 }, (_, i) => ({ question: `检查问题 ${i + 1}`, expected: i < 10 ? ["article:known"] : [], split: i % 2 ? "holdout" : "train" }));
  const detail = { ...run, cases, results: cases.map((item, i) => [{ target: "article:known", score: i <= 10 ? .9 : .2 }]), sourceTitles: { "article:known": "本站文章" }, issue: null, report: { policyVersion: 2, passed: true, recall: 1, hits: 10, positiveCases: 10, negativeCases: 10, falsePositives: 1, holdoutRecall: 1, holdoutFalsePositives: 1, threshold: .6 } };
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: detail } });
    if (resource === "sources") return route.fulfill({ json: { sources: [] } });
    if (route.request().method() === "POST") actions.push(route.request().postDataJSON().action);
    return route.fulfill({ json: { status: { ...status, evaluations: [run] } } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await expect(page.getByRole("button", { name: "确认启用这份知识库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "将本站文章加入问题 11 的可接受来源", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "该题由“本站没有答案”改为有答案" })).toBeVisible();
  await expect(page.getByRole("button", { name: "下一步：确认检查范围", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认启用这份知识库", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "取消编辑问题", exact: true }).click();
  await page.getByRole("button", { name: "放弃本次修改", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认启用这份知识库", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑诊断问题", exact: true }).click();
  await page.getByLabel("问题 11 内容", { exact: true }).fill("完全不同的新问题");
  await page.getByRole("button", { name: "保留草稿，核对其他检索来源", exact: true }).click();
  await expect(page.getByRole("button", { name: "将本站文章加入问题 11 的可接受来源", exact: true })).toBeDisabled();
  await expect(page.getByText("该题已在草稿中修改或移除，旧检索结果不能用于新问题。", { exact: true })).toBeVisible();
  expect(cases[10].expected).toEqual([]); expect(actions).toEqual([]);
});

for (const checked of [false, true]) test(`Owner can enable complete knowledge with ${checked ? "zero-recall" : "no"} diagnostics`, async ({ page }, info) => {
  const status = saved(); const actions: Record<string, unknown>[] = [];
  const run = { id: "00000000-0000-4000-8000-000000000005", generationId: status.generations[0].id, sourceRevision: 8, state: "complete" as const, completed: 1, total: 1, attempts: 1 };
  if (checked) status.evaluations = [run];
  const detail = { ...run, cases: [{ question: "复杂且合理的真实问题？", expected: ["article:known"], split: "train" }], results: [[{ target: "article:other", score: .9 }]], issue: null, report: { policyVersion: 3, hits: 0, positiveCases: 1, negativeCases: 0, falsePositives: 0, recall: 0, threshold: .5 } };
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "sources") return route.fulfill({ json: { sources: [] } });
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: detail } });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === "activate") { status.generations[0].state = "active"; status.activeGeneration = status.generations[0].id; }
    }
    return route.fulfill({ json: { status } });
  });
  await page.setViewportSize({ width: checked ? 1440 : 320, height: 1000 });
  await page.emulateMedia({ colorScheme: checked ? "light" : "dark", reducedMotion: "reduce" });
  await page.goto("/admin/ai?fixture=ready");
  await expect(page.locator('[aria-current="step"]')).toContainText("4．确认启用");
  await expect(page.getByRole("button", { name: "核对并修改问题", exact: true })).toHaveCount(0);
  const enable = page.getByRole("button", { name: "确认启用这份知识库", exact: true });
  await expect(enable).toBeDisabled();
  if (checked) {
    await expect(page.getByText(/^有答案题命中 0\/1/)).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑诊断问题", exact: true })).toBeVisible();
  }
  await page.getByLabel(/我决定启用这份知识库/).check();
  await expect(enable).toBeEnabled();
  await page.screenshot({ path: info.outputPath(`owner-enable-${checked ? "low" : "none"}.png`), fullPage: true });
  await enable.click();
  await expect(page.locator('[aria-current="step"]')).toContainText("5．使用与更新");
  expect(actions).toEqual([{ action: "activate", id: status.generations[0].id, accept: true, sourceRevision: 8, connection: status.selectedConnection }]);
  await page.reload();
  await expect(page.getByText("知识库已启用", { exact: true })).toBeVisible();
  expect(actions).toHaveLength(1);
});

test("An interrupted optional diagnostic does not keep a submitted draft as an activation blocker", async ({ page }) => {
  const status = saved(); const actions: string[] = [];
  const run = { id: "00000000-0000-4000-8000-000000000007", generationId: status.generations[0].id, sourceRevision: 8, state: "pending" as "pending" | "failed", completed: 0, total: 1, attempts: 0 };
  await page.route("**/api/admin/ai/index**", async route => {
    const resource = new URL(route.request().url()).searchParams.get("resource");
    if (resource === "sources") return route.fulfill({ json: { sources: [{ target: "article:known", title: "本站资料" }] } });
    if (resource === "evaluation") return route.fulfill({ json: { evaluation: { ...run, cases: [{ question: "真实问题", expected: ["article:known"], split: "train" }], results: [], report: null, issue: null } } });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); actions.push(body.action);
      if (body.action === "evaluation_start") status.evaluations = [run];
      if (body.action === "evaluation_step") run.state = "failed";
    }
    return route.fulfill({ json: { status, id: run.id } });
  });
  await page.goto("/admin/ai?fixture=ready");
  await page.getByText("可选：检查检索效果", { exact: true }).click();
  await page.getByRole("button", { name: "手工编写本站的问题", exact: true }).click();
  await page.getByLabel("问题 1 内容", { exact: true }).fill("真实问题");
  await page.getByLabel("问题 1 预期来源", { exact: true }).selectOption("article:known");
  await expect(page.getByLabel(/我决定启用这份知识库/)).toBeDisabled();
  await page.getByRole("button", { name: "下一步：确认检查范围", exact: true }).click();
  await page.getByLabel(/允许发送这 1 个问题/).check();
  await page.getByRole("button", { name: "确认并开始检查", exact: true }).click();
  await expect(page.getByText("检查中断", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/我决定启用这份知识库/)).toBeEnabled();
  await page.getByLabel(/我决定启用这份知识库/).check();
  await expect(page.getByRole("button", { name: "确认启用这份知识库", exact: true })).toBeEnabled();
  expect(actions).toEqual(["evaluation_start", "evaluation_step"]);
});
