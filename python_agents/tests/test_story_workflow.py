from copy import deepcopy
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
    create_story_run_state,
    rebuild_state,
    reject_growth_candidates,
    validate_complete_state,
)
from creative_graph_agents.story_workflow import build_story_graph
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


class ForbiddenCandidateStoryModel(MockJsonModel):
    def __init__(self, forbidden_title: str) -> None:
        super().__init__()
        self.forbidden_title = forbidden_title

    def generate_json(self, **kwargs):
        result = super().generate_json(**kwargs)
        if kwargs.get("task") == "story_write":
            result["full_script"] = (
                f"{result.get('full_script', '')}。{self.forbidden_title}"
            )
        return result


class StoryWorkflowTests(unittest.TestCase):
    def first_round(self) -> SharedState:
        initial = create_initial_state(
            "story-first-round",
            "疯狂水世界首轮发散",
            BRIEF,
        )
        return build_first_round_graph(MockJsonModel()).invoke(initial)

    def fully_decided(self) -> SharedState:
        return apply_first_round_decisions(
            self.first_round(),
            adopted_client_keys=["element_1", "conflict_1", "event_1"],
            rejected_client_keys=["element_2", "conflict_2", "event_2"],
            graph_version=11,
        )

    def story_initial(
        self,
        *,
        state: SharedState | None = None,
        max_repair_iterations: int = 1,
    ) -> SharedState:
        return create_story_run_state(
            state or self.fully_decided(),
            story_run_id="story-convergence-test",
            title_instruction="国王水枪挑战",
            max_repair_iterations=max_repair_iterations,
        )

    def test_ready_story_uses_every_adopted_node_and_preserves_source_state(self) -> None:
        initial = self.story_initial()
        before = deepcopy(initial)
        result = build_story_graph(MockJsonModel()).invoke(initial)

        self.assertEqual(initial, before)
        validate_complete_state(result)
        self.assertEqual(result["story"]["result"]["status"], "ready")
        adopted_node_ids = {
            node["node_id"] for node in result["graph_snapshot"]["nodes"]
        }
        self.assertEqual(
            set(result["story"]["result"]["used_node_ids"]),
            adopted_node_ids,
        )
        self.assertEqual(
            result["story"]["result"]["unused_adopted_node_ids"], []
        )
        self.assertTrue(result["story"]["result"]["cta"])
        self.assertTrue(
            set(result["story"]["result"]["used_edge_ids"]).issubset(
                {edge["edge_id"] for edge in result["graph_snapshot"]["edges"]}
            )
        )
        self.assertEqual(result["graph_snapshot"], before["graph_snapshot"])
        self.assertEqual(result["draft"], before["draft"])
        self.assertEqual(result["growth"], before["growth"])

        rejected_titles = {
            result["candidate_registry"]["candidates"][candidate_id]["title"]
            for candidate_id in result["candidate_registry"]["rejected_ids"]
        }
        full_script = result["story"]["result"]["full_script"]
        self.assertTrue(all(title not in full_script for title in rejected_titles))

    def test_pending_candidate_blocks_story_before_any_model_call(self) -> None:
        partially_decided = apply_first_round_decisions(
            self.first_round(),
            adopted_client_keys=["element_1", "conflict_1", "event_1"],
            rejected_client_keys=["element_2"],
            graph_version=3,
        )
        model = MockJsonModel()
        result = build_story_graph(model).invoke(
            self.story_initial(state=partially_decided)
        )

        self.assertEqual(result["story"]["result"]["status"], "failed")
        self.assertEqual(model.calls, [])
        self.assertIn("pending", result["errors"][0])

    def test_missing_category_requests_more_nodes_without_model_call(self) -> None:
        state = apply_first_round_decisions(
            self.first_round(),
            adopted_client_keys=["element_1", "conflict_1"],
            rejected_client_keys=[
                "element_2",
                "conflict_2",
                "event_1",
                "event_2",
            ],
            graph_version=4,
        )
        model = MockJsonModel()
        result = build_story_graph(model).invoke(self.story_initial(state=state))

        self.assertEqual(
            result["story"]["result"]["status"], "needs_more_nodes"
        )
        self.assertEqual(model.calls, [])
        self.assertIn(
            "剧情事件",
            result["story"]["result"]["readiness"]["missing_story_functions"],
        )

    def test_story_critic_can_trigger_one_beat_level_repair(self) -> None:
        model = MockJsonModel(force_first_story_critique_failure=True)
        result = build_story_graph(model).invoke(self.story_initial())

        self.assertEqual(result["story"]["result"]["status"], "ready")
        self.assertEqual(result["story"]["repair_iteration"], 1)
        self.assertEqual(model.calls.count("story_critic"), 2)
        self.assertEqual(model.calls.count("story_repair"), 1)
        self.assertIn(
            "修复后明确保持",
            result["story"]["result"]["full_script"],
        )

    def test_rejected_candidate_content_is_blocked_by_validator(self) -> None:
        selected = self.fully_decided()
        forbidden_id = selected["candidate_registry"]["rejected_ids"][0]
        forbidden_title = selected["candidate_registry"]["candidates"][forbidden_id][
            "title"
        ]
        model = ForbiddenCandidateStoryModel(forbidden_title)
        result = build_story_graph(model).invoke(
            self.story_initial(state=selected, max_repair_iterations=0)
        )

        self.assertEqual(result["story"]["result"]["status"], "needs_review")
        self.assertIn(
            forbidden_id,
            result["story"]["result"]["validation"]["forbidden_candidate_ids"],
        )

    def test_every_story_snapshot_is_complete(self) -> None:
        snapshots = list(
            build_story_graph(MockJsonModel()).stream(
                self.story_initial(),
                stream_mode="values",
            )
        )
        self.assertGreater(len(snapshots), 2)
        for snapshot in snapshots:
            self.assertEqual(set(snapshot), STATE_FIELDS)
            validate_complete_state(snapshot)

    def test_stale_graph_version_is_rejected(self) -> None:
        initial = self.story_initial()
        stale = rebuild_state(
            initial,
            graph_snapshot={
                **deepcopy(initial["graph_snapshot"]),
                "graph_version": initial["graph_snapshot"]["graph_version"] + 1,
            },
        )
        model = MockJsonModel()
        result = build_story_graph(model).invoke(stale)

        self.assertEqual(result["story"]["result"]["status"], "failed")
        self.assertEqual(model.calls, [])
        self.assertTrue(
            any("图谱版本已变化" in error for error in result["errors"])
        )

    def test_adopted_growth_node_is_included_after_its_batch_is_resolved(self) -> None:
        selected = self.fully_decided()
        growth_initial = create_growth_run_state(
            selected,
            growth_run_id="story-growth-source",
            seed_node_id="initial:story-first-round:element_1",
            direction="generate_followup_event",
            requested_category="story_event",
        )
        generated = build_growth_graph(MockJsonModel()).invoke(growth_initial)
        candidate_id = generated["growth"]["result"]["candidates"][0][
            "candidate_id"
        ]
        adopted = adopt_growth_candidate(
            generated,
            candidate_id=candidate_id,
            expected_graph_version=11,
        )
        result = build_story_graph(MockJsonModel()).invoke(
            self.story_initial(state=adopted)
        )

        self.assertEqual(result["candidate_registry"]["pending_ids"], [])
        self.assertEqual(result["story"]["result"]["status"], "ready")
        self.assertIn(
            adopted["growth"]["result"]["adopted_node_id"],
            result["story"]["result"]["used_node_ids"],
        )

    def test_rejecting_a_complete_growth_batch_unblocks_story(self) -> None:
        selected = self.fully_decided()
        generated = build_growth_graph(MockJsonModel()).invoke(
            create_growth_run_state(
                selected,
                growth_run_id="story-rejected-growth",
                seed_node_id="initial:story-first-round:element_1",
                direction="add_obstacle",
                requested_category="motivation_conflict",
            )
        )
        rejected = reject_growth_candidates(
            generated,
            expected_graph_version=11,
            rejection_reason="这一批不符合当前故事",
        )
        result = build_story_graph(MockJsonModel()).invoke(
            self.story_initial(state=rejected)
        )

        self.assertEqual(rejected["graph_snapshot"], selected["graph_snapshot"])
        self.assertEqual(rejected["candidate_registry"]["pending_ids"], [])
        self.assertEqual(rejected["growth"]["result"]["selection_status"], "rejected")
        self.assertEqual(result["story"]["result"]["status"], "ready")


if __name__ == "__main__":
    unittest.main()
