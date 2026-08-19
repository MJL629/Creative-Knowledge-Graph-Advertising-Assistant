import type { BaseCheckpointSaver } from "@langchain/langgraph";

import type { CreativeBrief, GraphCommitOperation, GraphSnapshot } from "../contracts";

export type WorkflowIntent = "start" | "grow" | "relations" | "concept";
export type WorkflowNextAction = WorkflowIntent | "commit" | "stop";

export type HumanDecision =
  | { action: "commit"; operations: GraphCommitOperation[] }
  | { action: "grow"; operations: GraphCommitOperation[]; focusNodeId: string }
  | { action: "relations"; operations: GraphCommitOperation[]; sourceNodeId: string; targetNodeId: string }
  | { action: "concept"; operations: GraphCommitOperation[] }
  | { action: "stop"; operations?: GraphCommitOperation[] };

export type WorkflowStartInput = {
  projectId: string;
  threadId?: string;
  intent?: WorkflowIntent;
  focusNodeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  needRag?: boolean;
};

export type WorkflowPublicState = {
  projectId: string;
  threadId: string;
  intent: WorkflowIntent;
  graphRevision: number;
  graphSnapshot?: GraphSnapshot;
  brief?: CreativeBrief;
  candidateResult?: unknown;
  validationResult?: { valid: boolean; errors: string[] };
  next: string[];
  interrupts: unknown[];
  errors: string[];
};

export interface WorkflowCheckpointerProvider {
  getCheckpointer(): BaseCheckpointSaver;
  readonly durable: boolean;
  readonly name: string;
}
