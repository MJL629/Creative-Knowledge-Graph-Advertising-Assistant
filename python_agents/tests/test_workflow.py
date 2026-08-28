from copy import deepcopy
import unittest

from creative_graph_agents.model import MockJsonModel
from creative_graph_agents.state import STATE_FIELDS, create_initial_state, validate_complete_state
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


class WorkflowTests(unittest.TestCase):
    def initial(self, *, max_iterations: int = 2):
        return create_initial_state(
            "workflow-test",
            "疯狂水世界首轮发散",
            BRIEF,
            max_iterations=max_iterations,
        )

    def test_happy_path_generates_three_categories(self) -> None:
        model = MockJsonModel()
        graph = build_first_round_graph(model)
        initial = self.initial()
        before = deepcopy(initial)
        result = graph.invoke(initial)

        self.assertEqual(initial, before)
        validate_complete_state(result)
        self.assertEqual(result["final_result"]["status"], "ready_for_selection")
        self.assertEqual(result["iteration"], 0)
        self.assertEqual(len(result["final_result"]["candidates"]), 6)
        counts = {
            category: sum(
                item["category"] == category
                for item in result["final_result"]["candidates"]
            )
            for category in ("creative_element", "motivation_conflict", "story_event")
        }
        self.assertEqual(counts, {
            "creative_element": 2,
            "motivation_conflict": 2,
            "story_event": 2,
        })
        self.assertEqual(len(result["messages"]), 11)
        self.assertIn("select_case_skills", model.calls)
        self.assertLessEqual(len(result["case_skill_context"]["selected"]), 2)

    def test_critic_failure_routes_through_one_repair_cycle(self) -> None:
        model = MockJsonModel(force_first_critique_failure=True)
        result = build_first_round_graph(model).invoke(self.initial())
        self.assertEqual(result["final_result"]["status"], "ready_for_selection")
        self.assertEqual(result["iteration"], 1)
        self.assertEqual(model.calls.count("critic_review"), 2)
        self.assertEqual(model.calls.count("creative_repair"), 1)
        self.assertIn("产生不可替代的因果作用", result["draft"]["story_blueprint"]["product_role"])

    def test_repair_limit_returns_needs_review(self) -> None:
        model = MockJsonModel(force_first_critique_failure=True)
        result = build_first_round_graph(model).invoke(self.initial(max_iterations=0))
        self.assertEqual(result["final_result"]["status"], "needs_review")
        self.assertEqual(result["iteration"], 0)
        self.assertNotIn("creative_repair", model.calls)

    def test_every_streamed_snapshot_is_complete(self) -> None:
        graph = build_first_round_graph(MockJsonModel())
        snapshots = list(graph.stream(self.initial(), stream_mode="values"))
        self.assertGreater(len(snapshots), 2)
        for snapshot in snapshots:
            self.assertEqual(set(snapshot), STATE_FIELDS)
            validate_complete_state(snapshot)

    def test_invalid_brief_finishes_without_calling_model(self) -> None:
        model = MockJsonModel()
        initial = create_initial_state("invalid", "", {"product": "", "ideaFragments": []})
        result = build_first_round_graph(model).invoke(initial)
        self.assertEqual(result["final_result"]["status"], "failed")
        self.assertEqual(model.calls, [])
        self.assertEqual([message["node"] for message in result["messages"]], ["normalizer", "finalizer"])


if __name__ == "__main__":
    unittest.main()
