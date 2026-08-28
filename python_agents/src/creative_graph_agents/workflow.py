"""StateGraph definition for first-round creative divergence."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .model import JsonModel
from .nodes import CreativeWorkflowNodes, route_after_critic, route_after_normalize
from .state import SharedState


def build_first_round_graph(model: JsonModel):
    """Compile the workflow with explicit sequential analysis nodes.

    The analysis nodes intentionally do not fan out in parallel. Under this
    project's contract every node returns every SharedState field and no field
    has a reducer. Parallel full-state writes would therefore conflict in the
    same LangGraph superstep.
    """

    nodes = CreativeWorkflowNodes(model)
    builder = StateGraph(SharedState)

    builder.add_node("normalize_brief", nodes.normalize_brief)
    builder.add_node("supervisor", nodes.supervisor)
    builder.add_node("select_case_skills", nodes.select_case_skills)
    builder.add_node("subject_analyst", nodes.subject_analyst)
    builder.add_node("advertising_analyst", nodes.advertising_analyst)
    builder.add_node("conflict_analyst", nodes.conflict_analyst)
    builder.add_node("narrative_analyst", nodes.narrative_analyst)
    builder.add_node("creative", nodes.creative)
    builder.add_node("creative_repair", nodes.creative_repair)
    builder.add_node("validator", nodes.validator)
    builder.add_node("critic", nodes.critic)
    builder.add_node("finalize", nodes.finalize)

    builder.add_edge(START, "normalize_brief")
    builder.add_conditional_edges("normalize_brief", route_after_normalize)
    builder.add_edge("supervisor", "select_case_skills")
    builder.add_edge("select_case_skills", "subject_analyst")
    builder.add_edge("subject_analyst", "advertising_analyst")
    builder.add_edge("advertising_analyst", "conflict_analyst")
    builder.add_edge("conflict_analyst", "narrative_analyst")
    builder.add_edge("narrative_analyst", "creative")
    builder.add_edge("creative", "validator")
    builder.add_edge("creative_repair", "validator")
    builder.add_edge("validator", "critic")
    builder.add_conditional_edges("critic", route_after_critic)
    builder.add_edge("finalize", END)

    return builder.compile()
