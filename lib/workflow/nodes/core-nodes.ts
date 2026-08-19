import { interrupt } from "@langchain/langgraph";

import {
  AppError,
  ERROR_CODES,
  type CreativeAgentGateway,
  type GraphNode,
  type RetrievalProvider,
} from "../../contracts";
import type { ProjectRepository } from "../../repositories/project-repository";
import type { CreativeState, CreativeStateUpdate } from "../creative-state";
import { buildConceptContext, buildGrowthContext, buildRelationContext, buildStartContext } from "../context-builder";
import type { HumanDecision } from "../workflow-types";

export type WorkflowDependencies = {
  repository: ProjectRepository;
  retrievalProvider: RetrievalProvider;
  agentGateway: CreativeAgentGateway;
};

function requireGraph(state: CreativeState) {
  if (!state.graphSnapshot || !state.brief) {
    throw new AppError(ERROR_CODES.GRAPH_NOT_FOUND, "Workflow project context is not loaded", 404);
  }
  return { graph: state.graphSnapshot, brief: state.brief };
}

function candidateValidation(result: unknown) {
  const errors: string[] = [];
  if (!result || typeof result !== "object") errors.push("Agent result must be an object");
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (!(Array.isArray(record.candidates) || Array.isArray(record.relations))) {
      errors.push("Agent result must contain candidates or relations");
    }
  }
  return { valid: errors.length === 0, errors };
}

function graphNodeInput(node: GraphNode) {
  return {
    id: node.id,
    title: node.title ?? node.label,
    description: node.description ?? "",
    category: node.category ?? node.type,
    subtype: node.subtype,
    status: node.status,
    parentId: node.parentId,
    actorRefs: node.actorRefs,
    productFeatureRefs: node.productFeatureRefs,
    attributes: node.attributes,
  };
}

export function createWorkflowNodes(dependencies: WorkflowDependencies) {
  const { repository, retrievalProvider, agentGateway } = dependencies;

  return {
    async loadProjectContext(state: CreativeState): Promise<CreativeStateUpdate> {
      const [project, graph] = await Promise.all([
        repository.getProject(state.projectId),
        repository.getGraph(state.projectId),
      ]);
      if (!project) throw new AppError(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404);
      if (!graph) throw new AppError(ERROR_CODES.GRAPH_NOT_FOUND, "Graph not found", 404);
      return { brief: project.brief, graphSnapshot: graph, graphRevision: graph.revision };
    },

    async contextPlan(state: CreativeState): Promise<CreativeStateUpdate> {
      const { brief } = requireGraph(state);
      const query = [brief.product, ...(brief.ideaFragments ?? [])].filter(Boolean).join(" ");
      const needRag = state.needRag || (!brief.knownFacts?.length && Boolean(query));
      return { needRag, retrievalQuery: query };
    },

    async retrieveContext(state: CreativeState): Promise<CreativeStateUpdate> {
      try {
        return {
          retrievedContext: await retrievalProvider.retrieve({
            projectId: state.projectId,
            query: state.retrievalQuery ?? state.brief?.product ?? "creative context",
            topK: 5,
          }),
        };
      } catch (error) {
        return {
          needRag: false,
          errors: [`Retrieval failed: ${error instanceof Error ? error.message : "unknown error"}`],
        };
      }
    },

    async creativeDivergence(state: CreativeState): Promise<CreativeStateUpdate> {
      const { brief } = requireGraph(state);
      return {
        candidateResult: await agentGateway.initialDivergence(buildStartContext(brief, state.retrievedContext), {
          projectId: state.projectId,
          graphRevision: state.graphRevision,
        }),
      };
    },

    async creativeGrowth(state: CreativeState): Promise<CreativeStateUpdate> {
      const { graph, brief } = requireGraph(state);
      const context = buildGrowthContext(graph, state.focusNodeId ?? "");
      if (!context) throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "Growth focus node not found", 400);
      const focus = context.focus;
      return {
        candidateResult: await agentGateway.growNode({
          brief,
          graphRevision: graph.revision,
          selectedNodeId: focus.id,
          graph: {
            nodes: context.nodes,
            edges: context.edges,
          },
          growthIntent: { mode: "deepen", targetCategory: focus.category ?? focus.type, candidateCount: 2 },
          subjectContract: {
            promotionSubject: brief.product,
            narrativeSubjectIds: [focus.id],
            productFeatureRefs: focus.productFeatureRefs ?? [],
          },
          retrievedContext: state.retrievedContext,
        }, { projectId: state.projectId, graphRevision: graph.revision }),
      };
    },

    async relationSuggestion(state: CreativeState): Promise<CreativeStateUpdate> {
      const { graph, brief } = requireGraph(state);
      const source = graph.nodes.find((node) => node.id === state.sourceNodeId);
      const target = graph.nodes.find((node) => node.id === state.targetNodeId);
      if (!source || !target) throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "Relation endpoints not found", 400);
      return {
        candidateResult: await agentGateway.suggestRelations({
          brief,
          sourceId: source.id,
          targetId: target.id,
          source: graphNodeInput(source),
          target: graphNodeInput(target),
          existingRelations: graph.edges.map((edge) => edge.label),
          excludedRelations: graph.edges.filter((edge) => edge.status === "excluded").map((edge) => edge.label),
          context: buildRelationContext(graph, source.id, target.id),
        }, { projectId: state.projectId, graphRevision: graph.revision }),
      };
    },

    async validateCandidate(state: CreativeState): Promise<CreativeStateUpdate> {
      return { validationResult: candidateValidation(state.candidateResult) };
    },

    async humanDecision(state: CreativeState): Promise<CreativeStateUpdate> {
      if (!state.validationResult?.valid) {
        throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "Candidate validation failed", 400, {
          errors: state.validationResult?.errors ?? ["Unknown validation failure"],
        });
      }
      const decision = interrupt<
        { threadId: string; intent: string; graphRevision: number; candidates: unknown },
        HumanDecision
      >({
        threadId: state.threadId,
        intent: state.intent,
        graphRevision: state.graphRevision,
        candidates: state.candidateResult,
      });
      return {
        humanDecision: decision,
        pendingOperations: decision.operations ?? [],
        nextAction: decision.action,
        intent: decision.action === "grow" || decision.action === "relations" || decision.action === "concept"
          ? decision.action
          : state.intent,
        focusNodeId: decision.action === "grow" ? decision.focusNodeId : state.focusNodeId,
        sourceNodeId: decision.action === "relations" ? decision.sourceNodeId : state.sourceNodeId,
        targetNodeId: decision.action === "relations" ? decision.targetNodeId : state.targetNodeId,
      };
    },

    async commitGraph(state: CreativeState): Promise<CreativeStateUpdate> {
      if (!state.pendingOperations.length) return {};
      const graph = await repository.commitGraph({
        projectId: state.projectId,
        expectedRevision: state.graphRevision,
        operations: state.pendingOperations,
      });
      return { graphSnapshot: graph, graphRevision: graph.revision, pendingOperations: [] };
    },

    async storyConvergence(state: CreativeState): Promise<CreativeStateUpdate> {
      const [project, graph] = await Promise.all([
        repository.getProject(state.projectId),
        repository.getGraph(state.projectId),
      ]);
      if (!project || !graph) throw new AppError(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404);
      const { adoptedNodes, adoptedEdges } = buildConceptContext(graph);
      return {
        brief: project.brief,
        graphSnapshot: graph,
        graphRevision: graph.revision,
        candidateResult: await agentGateway.convergeStory({ brief: project.brief, adoptedNodes, adoptedEdges }, {
          projectId: state.projectId,
          graphRevision: graph.revision,
        }),
      };
    },
  };
}
