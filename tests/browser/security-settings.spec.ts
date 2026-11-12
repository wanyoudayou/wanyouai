import { expect, test, type Page } from "@playwright/test";

const syntheticChallenge = `window.syntheticChallenges=[];window.turnstile={
  render(host,opts){
    const id=String(window.syntheticChallenges.push(opts));
    const box=document.createElement('div');box.dataset.syntheticWidget=id;
    const complete=document.createElement('button');complete.type='button';complete.textContent='完成测试校验';
    complete.onclick=()=>{opts.callback('synthetic-token-'+id);opts.callback('synthetic-token-'+id);};
    const fail=document.createElement('button');fail.type='button';fail.textContent='模拟校验失败';fail.onclick=()=>opts['error-callback']();
    box.append(complete,fail);host.appendChild(box);return id;
  },
  remove(id){document.querySelector('[data-synthetic-widget="'+id+'"]').remove();}
};`;

async function mockAvatar(page: Page) {
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/avatar/ask", async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "text/plain", body: "这是合成分身回答。" });
  });
  return payloads;
}

for (const width of [320, 1440]) for (const theme of ["light", "dark"] as const) {
  test(`anonymous AI: send-only modal, cancel retains input, success sends once (${theme}, ${width}px)`, async ({ page }, info) => {
    let scriptRequests = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("https://challenges.cloudflare.com/**", route => {
      scriptRequests++;
      return route.fulfill({ contentType: "application/javascript", body: syntheticChallenge });
    });
    const payloads = await mockAvatar(page);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/blog/anonymous-ai");
    if (width < 768) await page.getByRole("button", { name: "分身", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "向站主的分身提问", exact: true }).last();
    await composer.fill("请介绍部署准备。");
    expect(scriptRequests).toBe(0);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await composer.press("Enter");
    const challenge = page.getByRole("dialog", { name: "发送前请完成人机验证" });
    await expect(challenge).toBeVisible();
    expect(payloads).toHaveLength(0);
    await expect(challenge.getByRole("button", { name: "完成测试校验" })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`challenge-${theme}-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(challenge).toHaveCount(0);
    await expect(composer).toHaveValue("请介绍部署准备。");
    await expect(composer).toBeFocused();
    expect(payloads).toHaveLength(0);
    await composer.press("Enter");
    await expect(challenge).toBeVisible();
    // A late callback from the cancelled widget must not authorize the new send.
    await page.evaluate(() => {
      (window as unknown as { syntheticChallenges: { callback: (token: string) => void }[] }).syntheticChallenges[0].callback("stale-token");
    });
    expect(payloads).toHaveLength(0);
    const currentWidget = await challenge.locator("[data-synthetic-widget]").getAttribute("data-synthetic-widget");
    await challenge.getByRole("button", { name: "完成测试校验" }).click();
    await expect(challenge).toHaveCount(0);
    await expect(composer).toHaveValue("");
    await expect(page.getByText("这是合成分身回答。", { exact: true }).filter({ visible: true })).toBeVisible();
    expect(payloads).toEqual([{ question: "请介绍部署准备。", pins: [], turnstileToken: `synthetic-token-${currentWidget}` }]);
    if (width < 768) await expect(page.getByRole("dialog", { name: "站主分身", exact: true })).toBeVisible();
    await composer.fill("还有哪些准备？");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(challenge).toBeVisible();
    expect(payloads).toHaveLength(1);
    await challenge.getByRole("button", { name: "取消发送" }).click();
    await expect(composer).toHaveValue("还有哪些准备？");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("anonymous hero: verification failure can retry; cancellation keeps the original question", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({ contentType: "application/javascript", body: syntheticChallenge }));
  const payloads = await mockAvatar(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/blog/anonymous-ai");
  const hero = page.getByRole("textbox", { name: "向站主的分身提问", exact: true });
  await hero.fill("首页问题需要保留。");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const challenge = page.getByRole("dialog", { name: "发送前请完成人机验证" });
  await challenge.getByRole("button", { name: "模拟校验失败" }).click();
  await expect(challenge.getByRole("alert")).toContainText("问题尚未发送");
  expect(payloads).toHaveLength(0);
  await challenge.getByRole("button", { name: "取消发送" }).click();
  await expect(hero).toHaveValue("首页问题需要保留。");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  await challenge.getByRole("button", { name: "模拟校验失败" }).click();
  await challenge.getByRole("button", { name: "重新验证" }).click();
  await challenge.getByRole("button", { name: "完成测试校验" }).click();
  await expect(challenge).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "站主分身", exact: true })).toBeVisible();
  await expect(page.getByText("这是合成分身回答。", { exact: true }).filter({ visible: true })).toBeVisible();
  expect(payloads).toHaveLength(1);
  expect(payloads[0].question).toBe("首页问题需要保留。");
});

test("anonymous AI: challenge script failure has a recoverable state and sends nothing", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", route => route.abort());
  const payloads = await mockAvatar(page);
  await page.goto("/blog/anonymous-ai");
  await page.getByRole("textbox", { name: "向站主的分身提问", exact: true }).first().fill("验证资源加载失败时保留。");
  await page.getByRole("button", { name: "提问", exact: true }).click();
  const challenge = page.getByRole("dialog", { name: "发送前请完成人机验证" });
  await expect(challenge.getByRole("alert")).toContainText("问题尚未发送");
  expect(payloads).toHaveLength(0);
  await page.unroute("https://challenges.cloudflare.com/**");
  await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({ contentType: "application/javascript", body: syntheticChallenge }));
  await challenge.getByRole("button", { name: "重新验证" }).click();
  await challenge.getByRole("button", { name: "完成测试校验" }).click();
  await expect(challenge).toHaveCount(0);
  await expect.poll(() => payloads.length).toBe(1);
});

test("signed-in AI: sends directly without loading a challenge", async ({ page }) => {
  let scriptRequests = 0;
  await page.route("https://challenges.cloudflare.com/**", route => { scriptRequests++; return route.abort(); });
  const payloads = await mockAvatar(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/blog/member-ai");
  await page.getByRole("textbox", { name: "向站主的分身提问", exact: true }).last().fill("登录用户直接发送。");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("这是合成分身回答。", { exact: true })).toBeVisible();
  expect(payloads).toEqual([{ question: "登录用户直接发送。", pins: [] }]);
  expect(scriptRequests).toBe(0);
});

for (const theme of ["light", "dark"] as const) for (const width of [320, 1440]) {
  test(`security settings: ${theme} at ${width}px keeps input private and fits the viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto("/admin/security");
    const secret = page.getByLabel("Secret Key", { exact: true });
    await expect(secret).toHaveAttribute("type", "password");
    await expect(secret).toHaveValue("");
    await secret.fill("synthetic-unsaved-private-key");
    await page.getByLabel("Site Key", { exact: true }).fill("replacement-site-key");
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await expect(secret).toHaveValue("synthetic-unsaved-private-key");
    await expect(page.getByLabel("Site Key", { exact: true })).toHaveValue("replacement-site-key");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("anonymous inquiry: widget token is sent once, failure keeps fields and requires a new challenge", async ({ page }) => {
  await page.route("https://challenges.cloudflare.com/**", route => route.fulfill({ contentType: "application/javascript", body: `window.turnstile={render(host,opts){const b=document.createElement('button');b.type='button';b.textContent='完成测试校验';b.onclick=()=>opts.callback('synthetic-token');host.appendChild(b);return 'synthetic-widget';},remove(){}};` }));
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/services/inquire", async route => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "测试拒绝，保留输入" }) });
  });
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto("/inquiry");
  await page.getByLabel(/需求描述/).fill("这是需要保留的合成服务询价需求文本。");
  await page.getByLabel(/联系邮箱/).fill("fixture@example.test");
  const submit = page.getByRole("button", { name: "提交询价", exact: true });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "完成测试校验" }).click();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.locator('form [role="alert"]')).toContainText("保留输入");
  expect(payloads).toHaveLength(1);
  expect(payloads[0].turnstile_token).toBe("synthetic-token");
  await expect(page.getByLabel(/需求描述/)).toHaveValue("这是需要保留的合成服务询价需求文本。");
  await expect(submit).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
