from copy import deepcopy
from typing import Any, Mapping
import unittest

from creative_graph_agents.growth_workflow import build_growth_graph
from creative_graph_agents.model import MockJsonModel
from creative_graph_agents.state import (
    STATE_FIELDS,
    SharedState,
    adopt_growth_candidate,
    apply_first_round_decisions,
    create_growth_run_state,
    create_initial_state,
    validate_complete_state,
)
from creative_graph_agents.workflow import build_first_round_graph


BRIEF = {
    "product": "疯狂水世界",
    "knownInformation": "多人休闲水枪对战游戏",
    "ideaFragments": [
        "国王把超长水枪当权杖",
        "输掉挑战的人会被装进透明水球",
    ],
    "mustKeep": ["多人对战", "清凉解压"],
    "mustAvoid": ["血腥暴力"],
    "audience": "18-30岁休闲游戏用户",
    "platform": "抖音",
    "durationSeconds": 30,
    "styles": ["荒诞反转", "节奏快"],
    "sellingPoints": ["多人同屏水枪对战"],
}


class DuplicateGrowthModel(MockJsonModel):
    def generate_json(
        self,
        *,
        task: str,
        system_prompt: str,
        payload: Mapping[str, Any],
    ) -> dict[str, Any]:
        result = super().generate_json(
            task=task,
            system_prompt=system_prompt,
            payload=payload,
        )
        if task == "growth_generate" and result.get("candidates"):
            result["candidates"][0]["title"] = "规则守护者"
        return result


class GrowthWorkflowTests(unittest.TestCase):
    def first_round(self) -> SharedState:
        initial = create_initial_state(
            "first-round-test",
            "疯狂水世界首轮发散",
            BRIEF,
        )
        return build_first_round_graph(MockJsonModel()).invoke(initial)

    def selected(self) -> SharedState:
        return apply_first_round_decisions(
            self.first_round(),
            adopted_client_keys=["element_1", "conflict_1", "event_1"],
            rejected_client_keys=["element_2"],
            graph_version=7,
        )

    def growth_initial(
        self,
        *,
        direction: str = "generate_followup_event",
        requested_category: str | None = "story_event",
        max_repair_iterations: int = 1,
    ) -> SharedState:
        selected = self.selected()
        return create_growth_run_state(
            selected,
            growth_run_id=f"growth-{direction}",
            seed_node_id="initial:first-round-test:element_1",
            direction=direction,
            requested_category=requested_category,
            additional_requirements="保持轻松荒诞，不增加新主角",
            max_repair_iterations=max_repair_iterations,
        )

    def test_growth_preserves_first_round_and_namespaces_new_candidates(self) -> None:
        initial = self.growth_initial()
        before = deepcopy(initial)
        first_round_draft = deepcopy(initial["draft"])
        first_round_result = deepcopy(initial["final_result"])
        result = build_growth_graph(MockJsonModel()).invoke(initial)

        self.assertEqual(initial, before)
        self.assertEqual(result["draft"], first_round_draft)
        self.assertEqual(result["final_result"], first_round_result)
        self.assertEqual(result["growth"]["result"]["status"], "ready_for_selection")
        self.assertEqual(result["growth"]["result"]["resolved_category"], "story_event")
        candidates = result["growth"]["result"]["candidates"]
        self.assertEqual(len(candidates), 3)
        for candidate in candidates:
            self.assertTrue(candidate["candidate_id"].startswith("growth:growth-"))
            self.assertEqual(candidate["seed_node_id"], "initial:first-round-test:element_1")
            self.assertIn(candidate["seed_node_id"], candidate["seed_node_refs"])

    def test_all_six_directions_resolve_expected_categories(self) -> None:
        cases = {
            "deepen_current": (None, "creative_element"),
            "generate_followup_event": ("story_event", "story_event"),
            "add_obstacle": ("motivation_conflict", "motivation_conflict"),
            "add_character_or_prop": ("creative_element", "creative_element"),
            "generate_reversal": (None, "story_event"),
            "create_parallel_plan": (None, "creative_element"),
        }
        for direction, (requested, expected) in cases.items():
            with self.subTest(direction=direction):
                initial = self.growth_initial(
                    direction=direction,
                    requested_category=requested,
                )
                result = build_growth_graph(MockJsonModel()).invoke(initial)
                self.assertEqual(result["growth"]["result"]["status"], "ready_for_selection")
                self.assertEqual(
                    result["growth"]["result"]["resolved_category"], expected
                )
                self.assertTrue(
                    all(
                        candidate["category"] == expected
                        for candidate in result["growth"]["result"]["candidates"]
                    )
                )

    def test_incompatible_direction_category_fails_before_model_call(self) -> None:
        initial = self.growth_initial(
            direction="generate_followup_event",
            requested_category="creative_element",
        )
        model = MockJsonModel()
        result = build_growth_graph(model).invoke(initial)
        self.assertEqual(result["growth"]["result"]["status"], "failed")
        self.assertEqual(model.calls, [])
        self.assertIn("只能生成 story_event", result["errors"][0])

    def test_growth_critic_can_trigger_one_local_repair(self) -> None:
        model = MockJsonModel(force_first_growth_critique_failure=True)
        result = build_growth_graph(model).invoke(self.growth_initial())
        self.assertEqual(result["growth"]["result"]["status"], "ready_for_selection")
        self.assertEqual(result["growth"]["repair_iteration"], 1)
        self.assertEqual(model.calls.count("growth_critic"), 2)
        self.assertEqual(model.calls.count("growth_repair"), 1)

    def test_duplicate_first_round_title_is_rejected_by_validator(self) -> None:
        result = build_growth_graph(DuplicateGrowthModel()).invoke(
            self.growth_initial(max_repair_iterations=0)
        )
        self.assertEqual(result["growth"]["result"]["status"], "needs_review")
        conflict_types = {
            item["conflict_type"]
            for item in result["growth"]["validation"]["conflicts"]
        }
        self.assertIn("exact_duplicate", conflict_types)

    def test_every_growth_snapshot_is_complete(self) -> None:
        snapshots = list(
            build_growth_graph(MockJsonModel()).stream(
                self.growth_initial(),
                stream_mode="values",
            )
        )
        self.assertGreater(len(snapshots), 2)
        for snapshot in snapshots:
            self.assertEqual(set(snapshot), STATE_FIELDS)
            validate_complete_state(snapshot)

    def test_pending_candidate_cannot_be_used_as_seed(self) -> None:
        selected = self.selected()
        with self.assertRaises(ValueError):
            create_growth_run_state(
                selected,
                growth_run_id="invalid-seed",
                seed_node_id="element_2",
                direction="deepen_current",
            )

    def test_adopted_growth_candidate_can_seed_the_next_round(self) -> None:
        generated = build_growth_graph(MockJsonModel()).invoke(self.growth_initial())
        candidate = generated["growth"]["result"]["candidates"][0]
        adopted = adopt_growth_candidate(
            generated,
            candidate_id=candidate["candidate_id"],
            expected_graph_version=7,
        )
        self.assertEqual(adopted["graph_snapshot"]["graph_version"], 8)
        self.assertEqual(
            adopted["growth"]["result"]["selection_status"], "adopted"
        )
        adopted_node_id = adopted["growth"]["result"]["adopted_node_id"]
        self.assertTrue(
            any(
                node["node_id"] == adopted_node_id
                for node in adopted["graph_snapshot"]["nodes"]
            )
        )

        next_initial = create_growth_run_state(
            adopted,
            growth_run_id="growth-second-round",
            seed_node_id=adopted_node_id,
            direction="deepen_current",
        )
        next_result = build_growth_graph(MockJsonModel()).invoke(next_initial)
        self.assertEqual(
            next_result["growth"]["result"]["status"], "ready_for_selection"
        )
        self.assertEqual(
            next_result["growth"]["result"]["seed_node_id"], adopted_node_id
        )

    def test_growth_adoption_rejects_stale_graph_version(self) -> None:
        generated = build_growth_graph(MockJsonModel()).invoke(self.growth_initial())
        candidate = generated["growth"]["result"]["candidates"][0]
        with self.assertRaises(ValueError):
            adopt_growth_candidate(
                generated,
                candidate_id=candidate["candidate_id"],
                expected_graph_version=6,
            )


if __name__ == "__main__":
    unittest.main()
