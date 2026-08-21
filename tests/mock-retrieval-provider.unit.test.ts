import assert from "node:assert/strict";
import test from "node:test";

import { developmentRetrievalQuerySamples, type CreativeCase } from "../lib/knowledge";
import { MockRetrievalProvider } from "../lib/retrieval/mock-retrieval-provider";

const provider = new MockRetrievalProvider();

test("query: ordinary keyword returns a relevant case", async () => {
  const result = await provider.retrieve({ query: "饮料" });
  assert.equal(result.hits[0]?.id, "dev_case_001_countdown_beverage");
});

test("query: multiple keywords improve the intended match", async () => {
  const result = await provider.retrieve({ query: "小红书 护肤 对照实验" });
  assert.equal(result.hits[0]?.id, "dev_case_002_split_screen_skincare");
});

test("query: unrelated keywords return no result", async () => {
  const result = await provider.retrieve({ query: "量子火箭发动机" });
  assert.deepEqual(result.hits, []);
});

test("query: empty or whitespace-only input returns no result", async () => {
  assert.deepEqual((await provider.retrieve({ query: "" })).hits, []);
  assert.deepEqual((await provider.retrieve({ query: "   " })).hits, []);
});

test("ranking: the most relevant case ranks first", async () => {
  const result = await provider.retrieve({ query: "通勤 降噪 声音对比" });
  assert.equal(result.hits[0]?.id, "dev_case_005_sound_first_headphones");
});

test("ranking: scores are descending", async () => {
  const hits = (await provider.retrieve({ query: "旅行 互动", topK: 12 })).hits;
  assert.ok(hits.every((hit, index) => index === 0 || hits[index - 1].score >= hit.score));
});

test("ranking: identical input has stable order", async () => {
  const input = { query: "旅行 互动", topK: 12 };
  const first = await provider.retrieve(input);
  const second = await provider.retrieve(input);
  assert.deepEqual(first, second);
});

test("topK: one returns at most one hit", async () => {
  assert.equal((await provider.retrieve({ query: "旅行", topK: 1 })).hits.length, 1);
});

test("topK: three returns at most three hits", async () => {
  assert.ok((await provider.retrieve({ query: "旅行", topK: 3 })).hits.length <= 3);
});

test("topK: a value above the dataset returns only matches", async () => {
  const hits = (await provider.retrieve({ query: "旅行", topK: 100 })).hits;
  assert.ok(hits.length > 0 && hits.length < 100);
});

test("filter: productCategory uses case-insensitive exact matching", async () => {
  const result = await provider.retrieve({ query: "教程", filters: { productCategory: "护肤" } });
  assert.ok(result.hits.length > 0);
  assert.ok(result.hits.every((hit) => hit.metadata?.productCategory === "护肤"));
});

test("filter: platform uses case-insensitive exact matching", async () => {
  const result = await provider.retrieve({ query: "旅行", filters: { platform: "视频号" } });
  assert.ok(result.hits.length > 0);
  assert.ok(result.hits.every((hit) => hit.metadata?.platform === "视频号"));
});

test("filter: hookType uses exact matching", async () => {
  const result = await provider.retrieve({ query: "互动", filters: { hookType: "选择题互动" } });
  assert.deepEqual(result.hits.map((hit) => hit.id), ["dev_case_009_choice_language_course"]);
});

test("filter: tags requires every requested tag", async () => {
  const result = await provider.retrieve({ query: "教程", filters: { tags: ["美食", "倒放"] } });
  assert.deepEqual(result.hits.map((hit) => hit.id), ["dev_case_006_reverse_recipe"]);
});

test("filter: no matching case returns an empty result", async () => {
  const result = await provider.retrieve({ query: "教程", filters: { productCategory: "不存在的品类" } });
  assert.deepEqual(result.hits, []);
});

test("result mapping: output satisfies RetrievalHit core fields", async () => {
  const result = await provider.retrieve({ query: "饮料", topK: 1 });
  const hit = result.hits[0];
  assert.equal(result.query, "饮料");
  assert.equal(typeof hit.id, "string");
  assert.equal(typeof hit.title, "string");
  assert.equal(typeof hit.content, "string");
  assert.equal(typeof hit.score, "number");
});

test("result mapping: source is omitted when fixture has no source", async () => {
  const sourceFree: CreativeCase = {
    id: "source-free",
    title: "无来源饮料案例",
    summary: "用于验证来源缺失。",
    productCategory: "饮料",
    schemaVersion: 1,
  };
  const hit = (await new MockRetrievalProvider([sourceFree]).retrieve({ query: "饮料" })).hits[0];
  assert.equal("source" in hit, false);
});

test("result mapping: metadata contains the matched case fields", async () => {
  const hit = (await provider.retrieve({ query: "饮料", topK: 1 })).hits[0];
  assert.equal(hit.metadata?.productCategory, "饮料");
  assert.equal(hit.metadata?.hookType, "倒计时挑战");
});

test("result mapping: content is non-empty structured context", async () => {
  const hit = (await provider.retrieve({ query: "饮料", topK: 1 })).hits[0];
  assert.match(hit.content, /^案例摘要：/);
});

test("abort: an already-aborted signal terminates with the platform AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider.retrieve({ query: "饮料" }, controller.signal), (error: unknown) =>
    error instanceof DOMException && error.name === "AbortError");
});

test("filter: unknown keys are ignored deterministically", async () => {
  const normal = await provider.retrieve({ query: "饮料" });
  const unknown = await provider.retrieve({ query: "饮料", filters: { futureField: "value" } });
  assert.deepEqual(unknown, normal);
});

test("topK: zero and negative values return no hits without throwing", async () => {
  assert.deepEqual((await provider.retrieve({ query: "旅行", topK: 0 })).hits, []);
  assert.deepEqual((await provider.retrieve({ query: "旅行", topK: -2 })).hits, []);
});

test("development query samples keep their expected fixture at top one", async () => {
  for (const sample of developmentRetrievalQuerySamples) {
    const result = await provider.retrieve({ query: sample.query, topK: sample.topK });
    assert.equal(result.hits[0]?.id, sample.expectedRelevantIds[0], sample.query);
  }
});
