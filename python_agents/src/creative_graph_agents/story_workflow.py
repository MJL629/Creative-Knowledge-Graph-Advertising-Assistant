"""StateGraph definition for adopted-subgraph Story Convergence."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .model import JsonModel
from .state import SharedState
from .story_nodes import (
    StoryWorkflowNodes,
    route_after_story_critic,
    route_after_story_readiness,
    route_after_story_request,
)


def build_story_graph(model: JsonModel):
    """Compile one immutable Story Convergence workflow."""

    nodes = StoryWorkflowNodes(model)
    builder = StateGraph(SharedState)

    builder.add_node("validate_story_request", nodes.validate_request)
    builder.add_node("build_story_context", nodes.build_context)
    builder.add_node("story_health_check", nodes.health_check)
    builder.add_node("story_planner", nodes.planner)
    builder.add_node("story_writer", nodes.writer)
    builder.add_node("story_validator", nodes.validator)
    builder.add_node("story_critic", nodes.critic)
    builder.add_node("story_repair", nodes.repair)
    builder.add_node("finalize_story", nodes.finalize)

    builder.add_edge(START, "validate_story_request")
    builder.add_conditional_edges("validate_story_request", route_after_story_request)
    builder.add_edge("build_story_context", "story_health_check")
    builder.add_conditional_edges("story_health_check", route_after_story_readiness)
    builder.add_edge("story_planner", "story_writer")
    builder.add_edge("story_writer", "story_validator")
    builder.add_edge("story_validator", "story_critic")
    builder.add_conditional_edges("story_critic", route_after_story_critic)
    builder.add_edge("story_repair", "story_validator")
    builder.add_edge("finalize_story", END)

    return builder.compile()
