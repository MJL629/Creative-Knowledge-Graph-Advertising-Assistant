import type { CreativeBrief } from "./creative-brief";
import type { GraphSnapshot } from "./graph";

export interface AgentRunContext {
  projectId?: string;
  graphRevision?: number;
  requestId?: string;
}

export interface CreativeAgentGateway {
  initialDivergence(input: CreativeBrief, context?: AgentRunContext, signal?: AbortSignal): Promise<unknown>;
  growNode(input: unknown, context?: AgentRunContext, signal?: AbortSignal): Promise<unknown>;
  suggestRelations(input: unknown, context?: AgentRunContext, signal?: AbortSignal): Promise<unknown>;
  convergeStory(input: unknown, context?: AgentRunContext, signal?: AbortSignal): Promise<unknown>;
}

export interface StoryConvergeInput {
  brief: CreativeBrief;
  graph?: GraphSnapshot;
  adoptedNodes?: unknown[];
  adoptedEdges?: unknown[];
}
