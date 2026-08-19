import { END, START, StateGraph } from "@langchain/langgraph";

import { CreativeStateAnnotation } from "./creative-state";
import { createWorkflowNodes, type WorkflowDependencies } from "./nodes/core-nodes";
import { routeAfterCommit, routeAfterContext, routeCreativeIntent } from "./routing/workflow-router";
import type { WorkflowCheckpointerProvider } from "./workflow-types";

export function createCreativeWorkflow(
  dependencies: WorkflowDependencies & { checkpointerProvider: WorkflowCheckpointerProvider },
) {
  const nodes = createWorkflowNodes(dependencies);
  const graph = new StateGraph(CreativeStateAnnotation)
    .addNode("load_project_context", nodes.loadProjectContext)
    .addNode("context_plan", nodes.contextPlan)
    .addNode("retrieve_context", nodes.retrieveContext)
    .addNode("creative_divergence", nodes.creativeDivergence)
    .addNode("creative_growth", nodes.creativeGrowth)
    .addNode("relation_suggestion", nodes.relationSuggestion)
    .addNode("validate_candidate", nodes.validateCandidate)
    .addNode("human_decision", nodes.humanDecision)
    .addNode("commit_graph", nodes.commitGraph)
    .addNode("story_convergence", nodes.storyConvergence)
    .addEdge(START, "load_project_context")
    .addEdge("load_project_context", "context_plan")
    .addConditionalEdges("context_plan", routeAfterContext)
    .addConditionalEdges("retrieve_context", routeCreativeIntent)
    .addEdge("creative_divergence", "validate_candidate")
    .addEdge("creative_growth", "validate_candidate")
    .addEdge("relation_suggestion", "validate_candidate")
    .addEdge("validate_candidate", "human_decision")
    .addEdge("human_decision", "commit_graph")
    .addConditionalEdges("commit_graph", routeAfterCommit)
    .addEdge("story_convergence", END);

  return graph.compile({ checkpointer: dependencies.checkpointerProvider.getCheckpointer() });
}
