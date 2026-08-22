import { expect, test } from "@playwright/test";

async function waitForReact(page: import("@playwright/test").Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector("main") || document.querySelector("button.add-idea");
    return Boolean(root && Object.keys(root).some((key) => key.startsWith("__react")));
  }, undefined, { timeout: 20_000 });
}

async function startFromBrief(page: import("@playwright/test").Page, product: string, idea: string) {
  await page.goto("/");
  await waitForReact(page);
  await page.getByRole("button", { name: "＋ 新建项目" }).click();
  await page.locator("label:has-text('推广对象') input").fill(product);
  await page.locator(".idea-field input").first().fill(idea);
  await page.getByRole("button", { name: /生成首轮创意图谱/ }).click();
  await expect(page.locator(".graph-node")).toHaveCount(6, { timeout: 30_000 });
}

test("项目库可以新建项目并进入 Brief", async ({ page }) => {
  await page.goto("/");
  await waitForReact(page);
  await expect(page.getByText("PROJECT LIBRARY")).toBeVisible();
  await page.getByRole("button", { name: "＋ 新建项目" }).click();
  await expect(page.getByRole("button", { name: /生成首轮创意图谱/ })).toBeVisible();
});

test("mock 完整闭环：Brief → 图谱 → 采用 → 生长 → 剧情 → 刷新恢复", async ({ page }) => {
  await startFromBrief(page, "E2E 测试水世界", "透明王冠挑战");

  await page.locator(".graph-node").first().click();
  await page.getByRole("button", { name: "✓ 采用" }).click();
  await expect(page.locator(".graph-stats")).toContainText("1 已采用");

  await page.locator(".graph-node.adopted").first().click();
  await page.getByRole("button", { name: "＋ 继续生长" }).first().click();
  await page.getByRole("button", { name: "生成候选 →" }).click();
  await expect(page.locator(".graph-node")).toHaveCount(8, { timeout: 30_000 });

  await page.getByRole("button", { name: /收敛为剧情/ }).click();
  await expect(page.getByText("TRACEABLE STORY OUTPUT")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "导出 Markdown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出分镜 CSV" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("TRACEABLE STORY OUTPUT")).toBeVisible({ timeout: 30_000 });
});

test("AI 服务返回 500 时显示错误提示而不是白屏", async ({ page }) => {
  await page.route("**/api/workflow/start", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "模拟服务器错误" } }),
  }));

  await startFromBrief(page, "错误测试产品", "一个碎片想法");
  await expect(page.locator(".generation-error")).toContainText("模拟服务器错误");
  await expect(page.locator("main")).toBeVisible();
});

test("AI 网络失败时页面不白屏且允许重试", async ({ page }) => {
  await page.route("**/api/workflow/start", (route) => route.abort("failed"));

  await page.goto("/");
  await waitForReact(page);
  await page.getByRole("button", { name: "＋ 新建项目" }).click();
  await page.locator("label:has-text('推广对象') input").fill("网络失败测试");
  await page.locator(".idea-field input").first().fill("测试想法");
  await page.getByRole("button", { name: /生成首轮创意图谱/ }).click();
  await expect(page.locator(".generation-error")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /生成首轮创意图谱/ })).toBeVisible();
  await expect(page.locator("main")).toBeVisible();
});
