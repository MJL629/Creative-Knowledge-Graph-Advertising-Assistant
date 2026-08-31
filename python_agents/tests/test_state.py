from copy import deepcopy
import unittest

from creative_graph_agents.nodes import CreativeWorkflowNodes
from creative_graph_agents.model import MockJsonModel
from creative_graph_agents.state import (
    STATE_FIELDS,
    create_initial_state,
    rebuild_state,
    validate_complete_state,
)


BRIEF = {
    "product": "疯狂水世界",
    "ideaFragments": ["国王把超长水枪当权杖"],
    "mustKeep": ["多人对战"],
    "mustAvoid": ["血腥暴力"],
    "sellingPoints": ["多人同屏水枪对战"],
    "durationSeconds": 30,
}


class SharedStateTests(unittest.TestCase):
    def test_initial_state_contains_every_field(self) -> None:
        state = create_initial_state("task-1", "brief", BRIEF)
        self.assertEqual(set(state), STATE_FIELDS)
        validate_complete_state(state)

    def test_rebuild_deep_copies_nested_mutable_values(self) -> None:
        state = create_initial_state("task-1", "brief", BRIEF)
        rebuilt = rebuild_state(
            state,
            metadata={**state["metadata"], "nested": {"values": [1]}},
        )
        rebuilt["raw_brief"]["ideaFragments"].append("new")
        rebuilt["metadata"]["nested"]["values"].append(2)
        self.assertEqual(state["raw_brief"]["ideaFragments"], BRIEF["ideaFragments"])
        self.assertNotIn("nested", state["metadata"])

    def test_rebuild_rejects_unknown_fields(self) -> None:
        state = create_initial_state("task-1", "brief", BRIEF)
        with self.assertRaises(KeyError):
            rebuild_state(state, not_a_state_field=True)

    def test_rebuild_deep_copies_growth_section(self) -> None:
        state = create_initial_state("task-1", "brief", BRIEF)
        rebuilt = rebuild_state(state)
        rebuilt["growth"]["request"]["additional_requirements"] = "new"
        rebuilt["growth"]["draft"]["new_candidates"].append({"local_key": "x"})
        self.assertEqual(state["growth"]["request"]["additional_requirements"], "")
        self.assertEqual(state["growth"]["draft"]["new_candidates"], [])

    def test_rebuild_deep_copies_registry_and_story_sections(self) -> None:
        state = create_initial_state("task-1", "brief", BRIEF)
        rebuilt = rebuild_state(state)
        rebuilt["candidate_registry"]["pending_ids"].append("candidate-x")
        rebuilt["story"]["draft"]["segments"].append({"segment_id": "beat-x"})
        self.assertEqual(state["candidate_registry"]["pending_ids"], [])
        self.assertEqual(state["story"]["draft"]["segments"], [])

    def test_node_returns_full_state_without_mutating_input(self) -> None:
        state = create_initial_state("task-1", "brief", BRIEF)
        before = deepcopy(state)
        result = CreativeWorkflowNodes(MockJsonModel()).normalize_brief(state)
        self.assertEqual(state, before)
        self.assertEqual(set(result), STATE_FIELDS)
        self.assertIsNot(result["messages"], state["messages"])
        self.assertIsNot(result["metadata"], state["metadata"])


if __name__ == "__main__":
    unittest.main()
