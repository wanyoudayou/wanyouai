import { expect, test } from "@playwright/test";

const release = { id: "10000000-0000-4000-8000-000000000001", skill_id: 1, version: "1.0.0", manifest: [{ path: "SKILL.md", size: 50, sha256: "b".repeat(64), text: true }], package_sha256: "a".repeat(64), skill_name: "text-helper" };
test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin/handbook-credentials", route => route.fulfill({ json: { items: [] } }));
});
for (const [theme, width] of [["light", 1440], ["dark", 320]] as const) {
  test(`Skill manager ${theme} ${width}px preserves inputs and layout`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error" && /hydrat|didn't match/i.test(message.text())) errors.push(message.text()); });
    await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme });
    await page.goto("/admin/skill-fixture");
    await page.getByLabel("使用引导", { exact: true }).fill("需要保留的使用说明");
    await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
    await expect(page.getByLabel("使用引导", { exact: true })).toHaveValue("需要保留的使用说明");
    await expect(page.getByRole("button", { name: "上传并校验", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
test("version pagination keeps current online eligibility; conflicts retain edits", async ({ page }) => {
  await page.route("**/api/admin/skills?*", route => route.fulfill({ json: { releases: { items: [], total: 21, page: 2 } } }));
  await page.route("**/api/admin/skills", route => route.fulfill({ status: 409, json: { message: "配置已被更新，请核对后重新保存。" } }));
  await page.goto("/admin/skill-fixture"); await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByRole("option", { name: "1.0.0（在其他页）" })).toBeAttached();
  await expect(page.getByLabel(/启用在线文本对话/)).toBeEnabled();
  await page.getByLabel("使用引导", { exact: true }).fill("新草稿");
  await page.getByRole("button", { name: "保存使用配置", exact: true }).click();
  await expect(page.getByText("配置已被更新，请核对后重新保存。")).toBeVisible();
  await expect(page.getByLabel("使用引导", { exact: true })).toHaveValue("新草稿");
});
test("install grants stay out of URLs and can be revoked", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => { (window as unknown as { copiedInstruction: string }).copiedInstruction = text; } } }); });
  const calls: object[] = [];
  await page.route("**/api/skills/delivery", async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    await route.fulfill({ json: body.op === "install" ? { id: "grant", token: "synthetic-private-grant", expiresAt: "2026-10-24T00:15:00Z", release } : { message: "本次安装授权已撤销。" } });
  });
  await page.goto("/admin/skill-fixture");
  await page.getByRole("button", { name: "生成远程安装说明" }).click();
  await expect(page.getByLabel("远程安装说明")).toContainText("Authorization: Bearer synthetic-private-grant");
  await expect(page.getByText("把本段提示词发送给你使用的 Agent。")).toBeVisible();
  await page.getByRole("button", { name: "复制安装提示词" }).click();
  await expect(page.getByRole("button", { name: "已复制提示词" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copiedInstruction: string }).copiedInstruction)).toContain("Authorization: Bearer synthetic-private-grant");
  expect(page.url()).not.toContain("grant");
  await page.getByRole("button", { name: "撤销这次安装授权" }).click();
  await expect(page.getByLabel("远程安装说明")).toHaveCount(0);
  expect(calls).toEqual([{ op: "install", release: release.id }, { op: "revoke", release: release.id, id: "grant" }]);
});
test("new Skill introduction fixes content type and public access with an explanation", async ({ page }) => {
  await page.goto("/admin/skill-new");
  await expect(page.getByLabel("内容类型", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("阅读权限", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("阅读权限", { exact: true })).toHaveValue("public");
  await expect(page.getByText("已固定为 Skill 公开介绍。")).toBeVisible();
  await page.getByLabel("标题", { exact: true }).fill("可编辑的介绍标题");
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("可编辑的介绍标题");
});
for (const [width, theme] of [[320, "dark"], [960, "light"], [1440, "dark"]] as const) test(`Skill sidebar switches in place at ${width}px`, async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const navigation: string[] = [];
  await page.setViewportSize({ width, height: 1000 }); await page.emulateMedia({ colorScheme: theme });
  await page.goto("/skills/text-helper");
  await page.getByRole("main").evaluate(element => { element.dataset.preserved = "same-introduction"; });
  page.on("request", request => { if (request.isNavigationRequest() || request.url().includes("_rsc=")) navigation.push(request.url()); });
  if (width < 768) await page.getByRole("button", { name: "SKILL", exact: true }).click();
  else if (width < 1280) await page.getByRole("button", { name: "打开 Skill 面板", exact: true }).click();
  const visible = (label: string) => page.getByRole("button", { name: label, exact: true }).filter({ visible: true });
  await expect(page.getByText("站主分身", { exact: true })).not.toBeVisible();
  await expect(visible("下载 v1.0.0")).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "下载 v1.0.0", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`skill-download-${width}.png`), animations: "disabled" });
  await visible("切换成在线测试").click();
  await expect(page).toHaveURL(/\/skills\/text-helper\?panel=online$/);
  await expect(page.locator("main").getByRole("heading", { name: "文本助手", exact: true, includeHidden: true })).toBeVisible();
  await expect(page.locator("main").getByLabel("输入问题")).toHaveCount(0);
  const question = page.getByLabel("输入问题", { exact: true }).filter({ visible: true });
  await question.fill("切换模式也保留的任务草稿");
  await question.press("Shift+Enter"); await expect(question).toHaveValue("切换模式也保留的任务草稿\n");
  await visible("切换成下载安装").click(); await expect(visible("下载 v1.0.0")).toBeVisible();
  await visible("切换成在线测试").click(); await expect(question).toHaveValue("切换模式也保留的任务草稿\n");
  await page.emulateMedia({ colorScheme: theme === "dark" ? "light" : "dark" });
  await expect(question).toHaveValue("切换模式也保留的任务草稿\n");
  if (width < 1280) {
    await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
    await (width < 768 ? visible("SKILL") : visible("打开 Skill 面板")).click();
    await expect(question).toHaveValue("切换模式也保留的任务草稿\n");
  }
  await page.screenshot({ path: info.outputPath(`skill-online-${width}.png`), animations: "disabled" });
  expect(await page.locator("main").getAttribute("data-preserved")).toBe("same-introduction");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(navigation).toEqual([]); expect(errors).toEqual([]);
});
test("download-only and unauthorized Skills cannot start a conversation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/skills/text-helper?offline=1");
  await expect(page.getByText("下载安装Skill", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /切换成在线测试/ })).toHaveCount(0);
  await page.goto("/skills/text-helper?locked=1");
  await page.getByRole("button", { name: "切换成在线测试", exact: true }).click();
  await expect(page.getByText("登录后即可确认此 Skill 的使用权限。")).toBeVisible();
  await expect(page.getByLabel("输入问题")).toHaveCount(0);
});
test("package upload interruption reuses its confirmation ID and does not switch the live version", async ({ page }) => {
  const calls: { op: string; id: string }[] = []; let confirmations = 0; let uploads = 0;
  await page.route("**/api/admin/skills", async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (body.op === "prepare") await route.fulfill({ json: { signedUrl: "http://127.0.0.1:1/storage/v1/object/upload/sign/skill-packages/staging/test.zip" } });
    else if (++confirmations === 1) await route.abort();
    else await route.fulfill({ json: { release: { ...release, version: "2.0.0" } } });
  });
  await page.route("**/storage/v1/object/upload/sign/skill-packages/staging/**", async route => { uploads++; await route.fulfill({ json: {} }); });
  await page.route("**/api/admin/skills?*", route => route.fulfill({ json: { releases: { items: [], page: 1, total: 0 } } }));
  await page.goto("/admin/skill-fixture");
  await page.getByLabel("ZIP 文件", { exact: true }).setInputFiles({ name: "test.zip", mimeType: "application/zip", buffer: Buffer.from("isolated-upload-fixture") });
  await page.getByLabel("版本号（发布后不可覆盖）").fill("2.0.0");
  await page.getByRole("button", { name: "上传并校验", exact: true }).click();
  const confirm = page.getByRole("button", { name: "查询并确认本次上传" }); await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByText("版本 2.0.0 已保存，请选择当前版本。")).toBeVisible();
  expect(uploads).toBe(1); expect(calls.map(c => c.op)).toEqual(["prepare", "finish", "finish"]);
  expect(new Set(calls.map(c => c.id)).size).toBe(1);
  await expect(page.getByRole("button", { name: "保存使用配置", exact: true })).toBeDisabled();
});
test("chat interruption requires read-only recovery and never loads model images", async ({ page }) => {
  let posts = 0; let turnId = "";
  await page.route("**/api/skills/chat*", async route => {
    if (route.request().method() === "POST") { posts++; turnId = route.request().postDataJSON().id; await route.abort(); }
    else await route.fulfill({ json: { version: "1.0.0", turns: [{ id: turnId, question: "请改写这段文字", answer: "已改写。 ![tracking](https://tracking.invalid/pixel) <script>alert(1)</script>", state: "complete" }] } });
  });
  const images: string[] = []; page.on("request", request => { if (request.url().includes("tracking.invalid")) images.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/skills/text-helper/chat");
  await expect(page.getByRole("heading", { name: "正在使用：文本助手" })).toBeVisible();
  await page.getByLabel("输入问题").fill("请改写这段文字"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "查询本轮状态" }).click();
  await expect(page.getByText(/已改写。/)).toBeVisible(); expect(posts).toBe(1); expect(images).toEqual([]);
  await expect(page).toHaveURL(/\?panel=online&session=[0-9a-f-]+$/); expect(page.url()).not.toContain("改写");
  await page.getByRole("button", { name: "新建对话" }).click();
  await expect(page.getByText(/已改写。/)).toHaveCount(0);
  await expect(page).toHaveURL(/\/skills\/text-helper\?panel=online$/);
});
test("Skill mode switches preserve a running turn and refresh restores only its history", async ({ page }) => {
  let posts = 0; let turnId = ""; let proceed: () => void = () => {};
  const pending = new Promise<void>(resolve => { proceed = resolve; });
  const reads: string[] = [];
  await page.route("**/api/skills/chat*", async route => {
    if (route.request().method() === "POST") {
      posts++; turnId = route.request().postDataJSON().id;
      await pending; await route.fulfill({ json: { ok: true } });
    } else {
      reads.push(route.request().url());
      await route.fulfill({ json: { version: "1.0.0", turns: [{ id: turnId, question: "同一任务", answer: "这是本次 Skill 的结果。", state: "complete" }] } });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/skills/text-helper?panel=online");
  await page.getByLabel("输入问题", { exact: true }).fill("同一任务");
  await page.getByLabel("输入问题", { exact: true }).press("Enter");
  await expect.poll(() => posts).toBe(1);
  await page.getByRole("button", { name: "切换成下载安装", exact: true }).click();
  await page.getByRole("button", { name: "切换成在线测试", exact: true }).click();
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  expect(reads).toEqual([]);
  proceed(); await expect(page.getByText("这是本次 Skill 的结果。")).toBeVisible();
  const url = page.url(); await page.reload();
  await expect(page.getByText("这是本次 Skill 的结果。")).toBeVisible();
  await expect(page).toHaveURL(url); expect(posts).toBe(1);
  // Development Strict Mode may repeat a cancelled, read-only restoration request.
  // The invariant is one paid submission and every read bound to the same Skill/session.
  expect(reads.length).toBeGreaterThanOrEqual(2);
  for (const read of reads) {
    const query = new URL(read).searchParams;
    expect(query.get("skill")).toBe("1"); expect(query.get("session")).toBe(new URL(url).searchParams.get("session"));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("这是本次 Skill 的结果。").filter({ visible: true })).toBeVisible();
  expect(posts).toBe(1);
});
test("handbook credential appears once, can be hidden and revoked", async ({ page }) => {
  let created = false;
  await page.route("**/api/admin/handbook-credentials", async route => {
    if (route.request().method() === "GET") await route.fulfill({ json: { items: created ? [{ id: "connection", name: "笔记库", last_used_at: null }] : [] } });
    else { created = route.request().postDataJSON().op === "create"; await route.fulfill({ json: created ? { token: "synthetic-handbook-credential" } : {} }); }
  });
  await page.goto("/admin/skill-fixture"); await page.getByLabel("连接名称").fill("笔记库");
  await page.getByRole("button", { name: "创建手册上传凭据" }).click();
  await expect(page.getByLabel("手册上传凭据", { exact: true })).toHaveValue("synthetic-handbook-credential");
  await page.getByRole("button", { name: "已保存，隐藏凭据" }).click();
  await expect(page.getByLabel("手册上传凭据", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "撤销连接", exact: true }).click();
  await expect(page.getByRole("button", { name: "撤销连接", exact: true })).toHaveCount(0);
});
