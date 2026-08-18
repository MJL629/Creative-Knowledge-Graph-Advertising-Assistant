import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    process.env.CREATIVE_MODEL_PROVIDER = "mock";
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}`);
    workerPromise = import(workerUrl.href).then((module) => module.default);
  }
  return workerPromise;
}

async function render(path = "/") {
  return fetchWorker(path, { headers: { accept: "text/html" } });
}

async function fetchWorker(path, init = {}) {
  const worker = await getWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      CREATIVE_MODEL_PROVIDER: "mock",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function api(path, options = {}) {
  const response = await fetchWorker(path, {
    method: options.method ?? "GET",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = await response.json();
  return { response, payload };
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

  assert.match(initialRoute, /getCreativeAgentGateway/);
  assert.match(growthRoute, /getCreativeAgentGateway/);
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

  assert.match(relationsRoute, /getCreativeAgentGateway/);
  assert.match(conceptRoute, /getCreativeAgentGateway/);
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

test("project API supports create, read, update, list, delete and 404", async () => {
  const brief = {
    product: "夏日水枪节",
    ideaFragments: ["透明王冠", "倒计时挑战"],
    mustKeep: ["轻松"],
  };

  const created = await api("/api/projects", {
    method: "POST",
    body: { name: "水枪节项目", brief },
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.ok, true);
  const projectId = created.payload.result.id;
  assert.equal(created.payload.result.graphRevision, 0);

  const fetched = await api(`/api/projects/${projectId}`);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.payload.result.name, "水枪节项目");

  const updated = await api(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: { name: "水枪节项目 C0", brief: { ...brief, ideaFragments: ["透明王冠", "最后一秒反超"] } },
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.payload.result.name, "水枪节项目 C0");

  const listed = await api("/api/projects");
  assert.equal(listed.response.status, 200);
  assert.ok(listed.payload.result.some((item) => item.id === projectId));

  const deleted = await api(`/api/projects/${projectId}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 200);
  assert.equal(deleted.payload.result.deleted, true);

  const missing = await api(`/api/projects/${projectId}`);
  assert.equal(missing.response.status, 404);
  assert.equal(missing.payload.error.code, "PROJECT_NOT_FOUND");
});

test("graph API reads empty graph, commits operations and guards revisions", async () => {
  const created = await api("/api/projects", {
    method: "POST",
    body: {
      name: "Graph Commit Project",
      brief: { product: "夏日水枪节", ideaFragments: ["透明王冠"] },
    },
  });
  const projectId = created.payload.result.id;

  const emptyGraph = await api(`/api/projects/${projectId}/graph`);
  assert.equal(emptyGraph.response.status, 200);
  assert.equal(emptyGraph.payload.result.revision, 0);
  assert.deepEqual(emptyGraph.payload.result.nodes, []);
  assert.deepEqual(emptyGraph.payload.result.edges, []);

  const committed = await api("/api/graph/commit", {
    method: "POST",
    body: {
      projectId,
      expectedRevision: 0,
      operations: [
        {
          type: "ADD_NODE",
          node: {
            id: "node_test_1",
            label: "水枪国王",
            type: "creative_element",
            description: "活动主角",
          },
        },
        { type: "ADOPT_NODE", nodeId: "node_test_1" },
      ],
    },
  });
  assert.equal(committed.response.status, 200);
  assert.equal(committed.payload.result.revision, 1);
  assert.equal(committed.payload.result.nodes[0].status, "adopted");

  const conflict = await api("/api/graph/commit", {
    method: "POST",
    body: { projectId, expectedRevision: 0, operations: [] },
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.error.code, "GRAPH_REVISION_CONFLICT");
  assert.equal(conflict.payload.error.details.actualRevision, 1);

  const invalid = await api("/api/graph/commit", {
    method: "POST",
    body: { projectId, expectedRevision: 1, operations: [{ type: "ADOPT_NODE", nodeId: "missing" }] },
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.payload.error.code, "GRAPH_OPERATION_INVALID");
});

test("story API saves versions with incrementing version and graphRevision", async () => {
  const created = await api("/api/projects", {
    method: "POST",
    body: {
      name: "Story Project",
      brief: { product: "夏日水枪节", ideaFragments: ["透明王冠"] },
    },
  });
  const projectId = created.payload.result.id;

  const first = await api(`/api/projects/${projectId}/stories`, {
    method: "POST",
    body: { graphRevision: 0, content: { concept: "第一版", beats: [] } },
  });
  assert.equal(first.response.status, 201);
  assert.equal(first.payload.result.version, 1);
  assert.equal(first.payload.result.graphRevision, 0);

  const second = await api(`/api/projects/${projectId}/stories`, {
    method: "POST",
    body: { graphRevision: 0, content: { concept: "第二版", beats: [] } },
  });
  assert.equal(second.response.status, 201);
  assert.equal(second.payload.result.version, 2);

  const listed = await api(`/api/projects/${projectId}/stories`);
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.result.length, 2);
});

test("existing agent APIs still work in mock mode", async () => {
  const brief = {
    product: "夏日水枪节",
    ideaFragments: ["透明王冠", "倒计时挑战"],
    mustKeep: [],
    mustAvoid: [],
    platform: "抖音",
    durationSeconds: 30,
    styles: [],
  };

  const diverge = await api("/api/graph/diverge", { method: "POST", body: brief });
  assert.equal(diverge.response.status, 200);
  assert.equal(diverge.payload.ok, true);
  assert.ok(Array.isArray(diverge.payload.result.candidates));

  const grow = await api("/api/graph/grow", {
    method: "POST",
    body: {
      brief,
      graphRevision: 1,
      selectedNodeId: "node_1",
      graph: {
        nodes: [
          {
            id: "node_1",
            title: "水枪国王",
            description: "活动主角",
            category: "creative_element",
            status: "adopted",
            productFeatureRefs: ["多人同屏"],
          },
        ],
        edges: [],
      },
      growthIntent: { mode: "next_event", targetCategory: "story_event", candidateCount: 2 },
      subjectContract: {
        promotionSubject: "夏日水枪节",
        narrativeSubjectIds: ["node_1"],
        productFeatureRefs: ["多人同屏"],
      },
    },
  });
  assert.equal(grow.response.status, 200);
  assert.equal(grow.payload.ok, true);

  const relations = await api("/api/graph/relations", {
    method: "POST",
    body: {
      brief,
      sourceId: "node_1",
      targetId: "node_2",
      source: { id: "node_1", title: "水枪国王", description: "活动主角", category: "creative_element" },
      target: { id: "node_2", title: "十秒挑战", description: "倒计时冲突", category: "motivation_conflict" },
      existingRelations: [],
      excludedRelations: [],
    },
  });
  assert.equal(relations.response.status, 200);
  assert.equal(relations.payload.ok, true);

  const concept = await api("/api/graph/concept", {
    method: "POST",
    body: {
      brief,
      adoptedNodes: [
        { id: "node_1", title: "水枪国王", description: "活动主角", category: "creative_element" },
      ],
      adoptedEdges: [],
    },
  });
  assert.equal(concept.response.status, 200);
  assert.equal(concept.payload.ok, true);
});
