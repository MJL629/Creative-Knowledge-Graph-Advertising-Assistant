import { Annotation } from "@langchain/langgraph";

import type {
  CreativeBrief,
  GraphCommitOperation,
  GraphSnapshot,
  RetrievalResult,
} from "../contracts";
import type { HumanDecision, WorkflowGrowthMode, WorkflowIntent, WorkflowNextAction } from "./workflow-types";

export const CreativeStateAnnotation = Annotation.Root({
  projectId: Annotation<string>(),
  threadId: Annotation<string>(),
  requestId: Annotation<string | undefined>(),
  intent: Annotation<WorkflowIntent>(),
  brief: Annotation<CreativeBrief | undefined>(),
  graphRevision: Annotation<number>(),
  graphSnapshot: Annotation<GraphSnapshot | undefined>(),
  focusNodeId: Annotation<string | undefined>(),
  sourceNodeId: Annotation<string | undefined>(),
  targetNodeId: Annotation<string | undefined>(),
  growthMode: Annotation<WorkflowGrowthMode | undefined>(),
  targetCategory: Annotation<string | undefined>(),
  candidateCount: Annotation<2 | 3 | undefined>(),
  growthInstruction: Annotation<string | undefined>(),
  needRag: Annotation<boolean>(),
  retrievalQuery: Annotation<string | undefined>(),
  retrievedContext: Annotation<RetrievalResult | undefined>(),
  candidateResult: Annotation<unknown>(),
  validationResult: Annotation<{ valid: boolean; errors: string[] } | undefined>(),
  humanDecision: Annotation<HumanDecision | undefined>(),
  pendingOperations: Annotation<GraphCommitOperation[]>(),
  nextAction: Annotation<WorkflowNextAction>(),
  repairCount: Annotation<number>(),
  errors: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

export type CreativeState = typeof CreativeStateAnnotation.State;
export type CreativeStateUpdate = typeof CreativeStateAnnotation.Update;
