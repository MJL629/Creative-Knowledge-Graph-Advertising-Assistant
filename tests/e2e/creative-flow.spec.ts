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
  await page.locator(".detail-panel").getByRole("button", { name: "＋ 继续生长" }).click();
  await expect(page.getByRole("button", { name: "生成候选 →" })).toBeVisible();
  await page.getByRole("button", { name: "生成候选 →" }).click();
  await expect(page.locator(".graph-node")).toHaveCount(8, { timeout: 30_000 });

  await page.getByRole("button", { name: /收敛为剧情/ }).click();
  await expect(page.getByText("TRACEABLE STORY OUTPUT")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "导出 Markdown" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出分镜 CSV" })).toBeVisible();

  await page.reload();
  await expect(page.getByText("TRACEABLE STORY OUTPUT")).toBeVisible({ timeout: 30_000 });
});

test("首轮生成后可直接建立语义关系，不报 Node not found", async ({ page }) => {
  await startFromBrief(page, "连线测试产品", "连线想法");

  const first = page.locator(".graph-node").nth(0);
  const second = page.locator(".graph-node").nth(1);
  await first.click();
  await first.locator(".connector-dot").click();
  await second.click();
  await expect(page.locator(".relation-editor")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "确认关系" }).click();
  await expect(page.locator(".graph-stats")).toContainText("1 语义关系", { timeout: 30_000 });

  const firstLeft = await first.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const firstTop = await first.evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const secondLeft = await second.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  const secondTop = await second.evaluate((el) => parseFloat((el as HTMLElement).style.top));
  const line = page.locator("line.semantic").first();
  const x1 = Number(await line.getAttribute("x1"));
  const y1 = Number(await line.getAttribute("y1"));
  const x2 = Number(await line.getAttribute("x2"));
  const y2 = Number(await line.getAttribute("y2"));
  expect(Math.abs(x1 - (firstLeft + 44))).toBeLessThan(2);
  expect(Math.abs(y1 - (firstTop + 44))).toBeLessThan(2);
  expect(Math.abs(x2 - (secondLeft + 44))).toBeLessThan(2);
  expect(Math.abs(y2 - (secondTop + 44))).toBeLessThan(2);
});

test("图谱工具栏支持搜索和全部采用", async ({ page }) => {
  await startFromBrief(page, "搜索测试产品", "搜索想法");
  await expect(page.locator(".graph-node")).toHaveCount(6);

  await page.getByPlaceholder("搜索节点").fill("水枪国王");
  await expect(page.locator(".graph-node")).toHaveCount(1);
  await page.getByPlaceholder("搜索节点").fill("");
  await expect(page.locator(".graph-node")).toHaveCount(6);

  await page.getByRole("button", { name: "全部采用" }).click();
  await expect(page.locator(".graph-stats")).toContainText("6 已采用", { timeout: 30_000 });
});

test("结果页可编辑保存，AI 微调位置已预留", async ({ page }) => {
  await startFromBrief(page, "编辑测试产品", "编辑想法");
  await page.locator(".graph-node").first().click();
  await page.getByRole("button", { name: "✓ 采用" }).click();
  await page.getByRole("button", { name: /收敛为剧情/ }).click();
  await expect(page.getByText("TRACEABLE STORY OUTPUT")).toBeVisible({ timeout: 30_000 });

  await page.locator(".story-head input").first().fill("编辑后的一句话创意");
  await page.getByRole("button", { name: "保存版本" }).click();
  await expect(page.getByRole("button", { name: /已保存为版本/ })).toBeVisible({ timeout: 10_000 });

  await expect(page.getByText("AI 微调助手")).toBeVisible();
  await page.getByRole("button", { name: "节奏更快" }).click();
  await page.getByRole("button", { name: "生成修改建议" }).click();
  await expect(page.getByText("AI 微调服务尚未接入")).toBeVisible({ timeout: 10_000 });
});

test("AI 服务返回 500 时显示错误提示而不是白屏", async ({ page }) => {
  await page.route("**/api/workflow/start", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR", message: "模拟服务器错误" } }),
  }));

  await page.goto("/");
  await waitForReact(page);
  await page.getByRole("button", { name: "＋ 新建项目" }).click();
  await page.locator("label:has-text('推广对象') input").fill("错误测试产品");
  await page.locator(".idea-field input").first().fill("一个碎片想法");
  await page.getByRole("button", { name: /生成首轮创意图谱/ }).click();
  await expect(page.locator(".generation-error")).toContainText("模拟服务器错误", { timeout: 30_000 });
  await expect(page.locator("main")).toBeVisible();
});

test("409 冲突时应用最新图谱并显示提示而不是白屏", async ({ page }) => {
  await startFromBrief(page, "冲突测试产品", "冲突想法");

  await page.route("**/api/workflow/resume", (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({
      ok: false,
      error: {
        code: "GRAPH_REVISION_CONFLICT",
        message: "数据已更新，请重新加载",
        details: {
          snapshot: {
            projectId: "project-conflict",
            revision: 99,
            nodes: [],
            edges: [],
          },
        },
      },
    }),
  }));

  await page.locator(".graph-node").first().click();
  await page.getByRole("button", { name: "✓ 采用" }).click();
  await expect(page.locator(".architecture-panel")).toContainText("数据已更新", { timeout: 30_000 });
  await expect(page.locator(".architecture-panel")).toContainText("graphRevision 99");
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
