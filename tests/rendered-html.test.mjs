import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server renders the creative graph application", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.ok(html.length > 500);
});

test("initial and growth routes are wired to their agent pipelines", async () => {
  const [initialRoute, growthRoute, page, growthPipeline] = await Promise.all([
    readFile(new URL("../app/api/graph/diverge/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/graph/grow/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/agents/growth-pipeline.ts", import.meta.url), "utf8"),
  ]);

  assert.match(initialRoute, /runInitialGraphPipeline/);
  assert.match(growthRoute, /runGrowthPipeline/);
  assert.match(page, /fetch\("\/api\/graph\/grow"/);
  assert.match(growthPipeline, /supervisorAgent/);
  assert.match(growthPipeline, /creativeAgent/);
  assert.match(growthPipeline, /criticAgent/);
  assert.match(growthPipeline, /storyAgent/);
  assert.doesNotMatch(page, /titles:\s*Record<Category, string\[]>/);
});

test("relations and concept routes are wired to their pipelines (PRD 8.2)", async () => {
  const [relationsRoute, conceptRoute, page, graphPipeline] = await Promise.all([
    readFile(new URL("../app/api/graph/relations/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/graph/concept/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/agents/graph-pipeline.ts", import.meta.url), "utf8"),
  ]);

  assert.match(relationsRoute, /runRelationPipeline/);
  assert.match(conceptRoute, /runStoryConvergePipeline/);
  assert.match(graphPipeline, /runRelationPipeline/);
  assert.match(graphPipeline, /runStoryConvergePipeline/);
  // 前端确实调用了这两条新 API
  assert.match(page, /fetch\("\/api\/graph\/relations"/);
  assert.match(page, /fetch\("\/api\/graph\/concept"/);
});

test("mock provider exists and is routed (PRD 9.1 离线演示)", async () => {
  const [mockAdapter, llmAdapter] = await Promise.all([
    readFile(new URL("../lib/agents/mock-llm.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/agents/deepseek.ts", import.meta.url), "utf8"),
  ]);
  assert.match(mockAdapter, /callMockJson/);
  assert.match(llmAdapter, /CREATIVE_MODEL_PROVIDER/);
  assert.match(llmAdapter, /callMockJson/);
});

test("session persistence is wired (FR-11)", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /localStorage\.getItem/);
  assert.match(page, /localStorage\.setItem/);
  // 两种删除（FR-09）与节点编辑（FR-04）存在
  assert.match(page, /deleteNodeOnly/);
  assert.match(page, /deleteCascade/);
  assert.match(page, /saveEditNode/);
});

test("needs_review status and propagation wired (FR-12 / PRD 5.2)", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /needs_review/);
  assert.match(page, /confirmNeedsReview/);
  // 需复核不进入最终剧情（adopted 过滤精确匹配）
  assert.match(page, /node\.status === "adopted"/);
});

test("supervisor multi-intent routing wired (技术设计 4.1)", async () => {
  const [graphPipeline, growthPipeline] = await Promise.all([
    readFile(new URL("../lib/agents/graph-pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/agents/growth-pipeline.ts", import.meta.url), "utf8"),
  ]);
  // 四种 intent 路由存在
  assert.match(graphPipeline, /intent: "initial"/);
  assert.match(graphPipeline, /intent: "relation"/);
  assert.match(graphPipeline, /intent: "converge"/);
  assert.match(growthPipeline, /intent: "grow"/);
  // Structured Decision 完整字段
  assert.match(graphPipeline, /need_external_tool/);
  // 剧情引用校验（PRD 7.3）
  assert.match(graphPipeline, /未采用节点/);
});

test("node fields and layout wired (PRD 7.1 / FR-03)", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // 节点字段补全
  assert.match(page, /originalParentId/);
  assert.match(page, /originalDepth/);
  assert.match(page, /importance/);
  // 拖拽与层级整理
  assert.match(page, /setDragState/);
  assert.match(page, /autoLayout/);
});
