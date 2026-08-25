import assert from "node:assert/strict";
import test from "node:test";

import { parseModelJson } from "../lib/agents/deepseek";

test("DeepSeek JSON parser accepts plain, fenced and explanatory responses", () => {
  assert.deepEqual(parseModelJson('{"ok":true}'), { ok: true });
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseModelJson('下面是结果：\n{"ok":true}\n请查收。'), { ok: true });
});

test("DeepSeek JSON parser identifies truncated objects", () => {
  assert.throws(() => parseModelJson('{"candidates":['), /被截断/);
});
