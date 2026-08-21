import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreativeCaseEmbeddingText,
  creativeCaseToRetrievalHit,
  developmentCreativeCases,
  type CreativeCase,
} from "../lib/knowledge";

const completeCase: CreativeCase = {
  id: "complete-case",
  title: "完整案例",
  summary: "用于验证所有字段。",
  brand: "示例品牌",
  productCategory: "饮料",
  platform: "抖音",
  targetAudience: "年轻通勤人群",
  hookType: "倒计时",
  creativeElements: ["计时器", "分屏"],
  motivationConflict: "时间有限但需要完成任务。",
  storyStructure: "提出挑战-执行-揭晓",
  emotionCurve: ["紧张", "释放"],
  sellingPointPattern: "在行动结果中展示卖点",
  ctaPattern: "邀请复刻",
  tags: ["挑战", "短视频"],
  rawText: "仅用于来源审计，不应整段进入 embedding text。",
  sourceName: "Development fixture",
  sourceUrl: "https://example.invalid/development-fixture",
  language: "zh-CN",
  schemaVersion: 1,
};

test("embedding text uses complete fields, arrays and stable order", () => {
  const expected = [
    "标题：完整案例",
    "品牌：示例品牌",
    "品类：饮料",
    "平台：抖音",
    "目标受众：年轻通勤人群",
    "案例摘要：用于验证所有字段。",
    "Hook：倒计时",
    "创意元素：计时器、分屏",
    "核心冲突：时间有限但需要完成任务。",
    "故事结构：提出挑战-执行-揭晓",
    "情绪曲线：紧张、释放",
    "卖点植入：在行动结果中展示卖点",
    "CTA：邀请复刻",
    "标签：挑战、短视频",
  ].join("\n");
  assert.equal(buildCreativeCaseEmbeddingText(completeCase), expected);
  assert.equal(buildCreativeCaseEmbeddingText(completeCase), expected);
  assert.doesNotMatch(expected, /来源审计/);
});

test("embedding text skips absent optional fields without undefined or null", () => {
  const minimal: CreativeCase = {
    id: "minimal-case",
    title: "最小案例",
    summary: "只保留必要字段。",
    schemaVersion: 1,
  };
  const text = buildCreativeCaseEmbeddingText(minimal);
  assert.equal(text, "标题：最小案例\n案例摘要：只保留必要字段。");
  assert.doesNotMatch(text, /undefined|null/);
});

test("mapper preserves identity and score while producing contract metadata and source", () => {
  const hit = creativeCaseToRetrievalHit(completeCase, 0.731);
  assert.equal(hit.id, completeCase.id);
  assert.equal(hit.title, completeCase.title);
  assert.ok(hit.content.length > 0);
  assert.equal(hit.score, 0.731);
  assert.deepEqual(hit.metadata, {
    brand: "示例品牌",
    productCategory: "饮料",
    platform: "抖音",
    targetAudience: "年轻通勤人群",
    hookType: "倒计时",
    creativeElements: ["计时器", "分屏"],
    motivationConflict: "时间有限但需要完成任务。",
    storyStructure: "提出挑战-执行-揭晓",
    emotionCurve: ["紧张", "释放"],
    sellingPointPattern: "在行动结果中展示卖点",
    ctaPattern: "邀请复刻",
    tags: ["挑战", "短视频"],
    language: "zh-CN",
    schemaVersion: 1,
  });
  assert.deepEqual(hit.source, {
    name: "Development fixture",
    url: "https://example.invalid/development-fixture",
  });
});

test("mapper omits source and absent optional metadata", () => {
  const hit = creativeCaseToRetrievalHit({
    id: "source-free",
    title: "无来源案例",
    summary: "验证缺少来源时的映射。",
    schemaVersion: 1,
  }, -0.25);
  assert.equal(hit.score, -0.25);
  assert.equal("source" in hit, false);
  assert.deepEqual(hit.metadata, { schemaVersion: 1 });
  assert.doesNotMatch(JSON.stringify(hit), /undefined|null/);
});

test("development fixture set is diverse, uniquely identified and explicitly labelled", () => {
  assert.equal(developmentCreativeCases.length, 12);
  assert.equal(new Set(developmentCreativeCases.map((item) => item.id)).size, 12);
  assert.ok(new Set(developmentCreativeCases.map((item) => item.productCategory)).size >= 10);
  assert.ok(new Set(developmentCreativeCases.map((item) => item.platform)).size >= 5);
  assert.ok(developmentCreativeCases.every((item) => item.sourceName === "Development fixture"));
  assert.ok(developmentCreativeCases.every((item) => !item.sourceUrl));
});
