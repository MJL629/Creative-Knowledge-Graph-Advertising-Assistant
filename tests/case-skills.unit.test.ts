import assert from "node:assert/strict";
import test from "node:test";

import {
  getCaseSkillCatalog,
  resolveCaseSkillSelection,
  selectCreativeCaseSkills,
} from "../lib/agents/case-skills";

test("case skill catalog is lightweight and unique", () => {
  const catalog = getCaseSkillCatalog("initial");
  assert.ok(catalog.length >= 12);
  assert.equal(catalog.length, new Set(catalog.map((item) => item.skill_id)).size);
  assert.ok(catalog.every((item) => !("example" in item)));
  assert.ok(catalog.every((item) => item.triggers.length > 0));
});

test("case skill resolver enforces whitelist, uniqueness and two-card limit", () => {
  const ids = getCaseSkillCatalog("initial").slice(0, 4).map((item) => item.skill_id);
  const context = resolveCaseSkillSelection({
    selected_skills: [
      { skill_id: "unknown", reason: "ignored" },
      ...ids.map((skill_id) => ({ skill_id, reason: `selected ${skill_id}` })),
      { skill_id: ids[0], reason: "duplicate" },
    ],
  }, "initial");

  assert.equal(context.selected.length, 2);
  assert.ok(context.selected.every((item) => ids.includes(item.skillId)));
  assert.equal(new Set(context.selected.map((item) => item.skillId)).size, 2);
  assert.ok(context.selected.every((item) => Object.keys(item.example).length > 0));
});

test("resolved examples are defensive copies", () => {
  const firstId = getCaseSkillCatalog("growth")[0].skill_id;
  const first = resolveCaseSkillSelection({
    selected_skills: [{ skill_id: firstId, reason: "first" }],
  }, "growth");
  const second = resolveCaseSkillSelection({
    selected_skills: [{ skill_id: firstId, reason: "second" }],
  }, "growth");

  first.selected[0].example.changed = true;
  assert.equal(second.selected[0].example.changed, undefined);
});

test("selector failure degrades to an empty optional context", async () => {
  const context = await selectCreativeCaseSkills(
    { stage: "initial", brief: { product: "test" } },
    undefined,
    async () => { throw new Error("selector unavailable"); },
  );

  assert.deepEqual(context.selected, []);
  assert.equal(context.selectionMode, "auto");
  assert.match(context.warning ?? "", /已跳过案例参考/);
});

test("selector abort is not swallowed by optional fallback", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    selectCreativeCaseSkills(
      { stage: "growth", brief: { product: "test" } },
      controller.signal,
      async () => { throw new DOMException("cancelled", "AbortError"); },
    ),
    { name: "AbortError" },
  );
});
