"""StateGraph definition for one controlled creative growth run."""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from .growth_nodes import (
    GrowthWorkflowNodes,
    route_after_growth_critic,
    route_after_growth_request,
)
from .model import JsonModel
from .state import SharedState


def build_growth_graph(model: JsonModel):
    """Compile a sequential full-state workflow for one selected seed node."""

    nodes = GrowthWorkflowNodes(model)
    builder = StateGraph(SharedState)

    builder.add_node("validate_growth_request", nodes.validate_request)
    builder.add_node("build_context", nodes.build_context)
    builder.add_node("analyze_graph_gap", nodes.analyze_gap)
    builder.add_node("plan_growth", nodes.plan_growth)
    builder.add_node("growth_creative", nodes.creative)
    builder.add_node("growth_validator", nodes.validator)
    builder.add_node("growth_critic", nodes.critic)
    builder.add_node("growth_repair", nodes.repair)
    builder.add_node("finalize_growth", nodes.finalize)

    builder.add_edge(START, "validate_growth_request")
    builder.add_conditional_edges("validate_growth_request", route_after_growth_request)
    builder.add_edge("build_context", "analyze_graph_gap")
    builder.add_edge("analyze_graph_gap", "plan_growth")
    builder.add_edge("plan_growth", "growth_creative")
    builder.add_edge("growth_creative", "growth_validator")
    builder.add_edge("growth_validator", "growth_critic")
    builder.add_conditional_edges("growth_critic", route_after_growth_critic)
    builder.add_edge("growth_repair", "growth_validator")
    builder.add_edge("finalize_growth", END)

    return builder.compile()
