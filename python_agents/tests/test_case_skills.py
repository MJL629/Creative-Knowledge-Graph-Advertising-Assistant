from copy import deepcopy
from typing import Any, Mapping
import unittest
from unittest.mock import patch

from creative_graph_agents.case_skills import (
    MAX_SELECTED_SKILLS,
    get_case_skill_catalog,
    resolve_case_skill_context,
)
from creative_graph_agents.model import MockJsonModel
from creative_graph_agents.state import (
    create_initial_state,
    rebuild_state,
    validate_complete_state,
)
from creative_graph_agents.workflow import build_first_round_graph


BRIEF = {
    "product": "疯狂水世界",
    "knownInformation": "多人休闲水枪对战游戏",
    "ideaFragments": ["国王把超长水枪当权杖", "挑战失败会触发轻量惩罚"],
    "platform": "抖音",
    "styles": ["荒诞反转", "节奏快"],
    "sellingPoints": ["多人同屏水枪对战"],
}


class RecordingModel:
    def __init__(self) -> None:
        self.inner = MockJsonModel()
        self.payloads: dict[str, list[dict[str, Any]]] = {}

    def generate_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        self.payloads.setdefault(task, []).append(deepcopy(dict(payload)))
        return self.inner.generate_json(
            task=task,
            system_prompt=system_prompt,
            payload=payload,
        )


class SelectorFailureModel(RecordingModel):
    def generate_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        if task == "select_case_skills":
            raise ValueError("selector unavailable")
        return super().generate_json(
            task=task,
            system_prompt=system_prompt,
            payload=payload,
        )


class CaseSkillTests(unittest.TestCase):
    def test_catalog_is_lightweight_unique_and_does_not_expose_examples(self) -> None:
        catalog = get_case_skill_catalog()
        self.assertGreaterEqual(len(catalog), 12)
        self.assertEqual(len(catalog), len({item["skill_id"] for item in catalog}))
        self.assertTrue(all("example" not in item for item in catalog))
        self.assertTrue(all(item["triggers"] for item in catalog))

    def test_resolver_loads_only_trusted_known_cards_and_caps_selection(self) -> None:
        catalog = get_case_skill_catalog()
        requested = [
            {"skill_id": item["skill_id"], "reason": f"reason-{index}"}
            for index, item in enumerate(catalog[: MAX_SELECTED_SKILLS + 2])
        ]
        requested.insert(0, {"skill_id": "unknown", "reason": "must be ignored"})
        requested.append({"skill_id": catalog[0]["skill_id"], "reason": "duplicate"})
        context = resolve_case_skill_context({"selected_skills": requested})

        self.assertEqual(len(context["selected"]), MAX_SELECTED_SKILLS)
        self.assertNotIn("unknown", [item["skill_id"] for item in context["selected"]])
        self.assertTrue(all(item["example"] for item in context["selected"]))

    def test_catalog_and_resolver_enforce_requested_stage(self) -> None:
        resource = {
            "catalog_version": "stage-test-v1",
            "skills": [
                {
                    "skill_id": "initial-only",
                    "title": "Initial only",
                    "description": "Initial pattern",
                    "triggers": ["initial"],
                    "stages": ["initial"],
                    "example": {"hook_pattern": "initial"},
                },
                {
                    "skill_id": "growth-only",
                    "title": "Growth only",
                    "description": "Growth pattern",
                    "triggers": ["growth"],
                    "stages": ["growth"],
                    "example": {"hook_pattern": "growth"},
                },
            ],
        }
        with patch(
            "creative_graph_agents.case_skills._load_resource",
            return_value=resource,
        ):
            catalog = get_case_skill_catalog("initial")
            context = resolve_case_skill_context(
                {
                    "selected_skills": [
                        {"skill_id": "growth-only", "reason": "wrong stage"},
                        {"skill_id": "initial-only", "reason": "right stage"},
                    ]
                },
                stage="initial",
            )

        self.assertEqual([item["skill_id"] for item in catalog], ["initial-only"])
        self.assertEqual(
            [item["skill_id"] for item in context["selected"]],
            ["initial-only"],
        )

    def test_selector_uses_metadata_then_creative_receives_selected_cards(self) -> None:
        model = RecordingModel()
        initial = create_initial_state("skill-test", "water battle", BRIEF)
        before = deepcopy(initial)
        result = build_first_round_graph(model).invoke(initial)

        self.assertEqual(initial, before)
        validate_complete_state(result)
        selected = result["case_skill_context"]["selected"]
        self.assertTrue(selected)
        self.assertEqual(selected[0]["skill_id"], "royal-water-battle")
        selector_catalog = model.payloads["select_case_skills"][0]["skill_catalog"]
        self.assertTrue(all("example" not in item for item in selector_catalog))
        creative_context = model.payloads["creative_initial"][0]["case_skill_context"]
        self.assertEqual(creative_context, result["case_skill_context"])
        self.assertTrue(creative_context["selected"][0]["example"])

    def test_disabled_mode_skips_selector_model_call_and_keeps_empty_context(self) -> None:
        model = MockJsonModel()
        brief = {**BRIEF, "caseSkillMode": "disabled"}
        result = build_first_round_graph(model).invoke(
            create_initial_state("skill-disabled", "water battle", brief)
        )

        self.assertNotIn("select_case_skills", model.calls)
        self.assertEqual(result["case_skill_context"]["selection_mode"], "disabled")
        self.assertEqual(result["case_skill_context"]["selected"], [])
        self.assertIn(
            "case_skill_selector",
            [message["node"] for message in result["messages"]],
        )

    def test_selector_failure_degrades_without_stopping_first_round(self) -> None:
        result = build_first_round_graph(SelectorFailureModel()).invoke(
            create_initial_state("skill-fallback", "water battle", BRIEF)
        )

        validate_complete_state(result)
        self.assertEqual(result["current_stage"], "completed")
        self.assertEqual(result["case_skill_context"]["selected"], [])
        self.assertTrue(
            any("case skill selector skipped" in error for error in result["errors"])
        )
        self.assertIn(
            "案例技能选择暂不可用，已跳过案例参考",
            [message["content"] for message in result["messages"]],
        )

    def test_rebuild_does_not_reuse_nested_selected_examples(self) -> None:
        state = create_initial_state("skill-copy", "water battle", BRIEF)
        selected = resolve_case_skill_context({
            "selected_skills": [
                {"skill_id": "royal-water-battle", "reason": "relevant"}
            ]
        })
        state = rebuild_state(state, case_skill_context=selected)
        rebuilt = rebuild_state(state)
        rebuilt["case_skill_context"]["selected"][0]["example"]["creative_elements"].append("new")
        self.assertNotEqual(
            rebuilt["case_skill_context"],
            state["case_skill_context"],
        )


if __name__ == "__main__":
    unittest.main()
