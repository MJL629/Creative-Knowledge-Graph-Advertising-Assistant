import { Command } from "@langchain/langgraph";

import type { CreativeAgentGateway, RetrievalProvider } from "../contracts";
import type { ProjectRepository } from "../repositories/project-repository";
import { createCreativeWorkflow } from "./creative-workflow";
import type { CreativeState } from "./creative-state";
import type {
  HumanDecision,
  WorkflowCheckpointerProvider,
  WorkflowPublicState,
  WorkflowStartInput,
} from "./workflow-types";

type RuntimeDependencies = {
  repository: ProjectRepository;
  retrievalProvider: RetrievalProvider;
  agentGateway: CreativeAgentGateway;
  checkpointerProvider: WorkflowCheckpointerProvider;
};

export class WorkflowRuntime {
  private readonly workflow;

  constructor(dependencies: RuntimeDependencies) {
    this.workflow = createCreativeWorkflow(dependencies);
  }

  private config(threadId: string) {
    return { configurable: { thread_id: threadId }, recursionLimit: 30 };
  }

  private async publicState(threadId: string): Promise<WorkflowPublicState> {
    const snapshot = await this.workflow.getState(this.config(threadId));
    const state = snapshot.values as CreativeState;
    return {
      projectId: state.projectId,
      threadId,
      requestId: state.requestId,
      intent: state.intent,
      graphRevision: state.graphRevision,
      focusNodeId: state.focusNodeId,
      sourceNodeId: state.sourceNodeId,
      targetNodeId: state.targetNodeId,
      graphSnapshot: state.graphSnapshot,
      brief: state.brief,
      candidateResult: state.candidateResult,
      validationResult: state.validationResult,
      next: [...snapshot.next],
      interrupts: snapshot.tasks.flatMap((task) => task.interrupts?.map((item) => item.value) ?? []),
      errors: state.errors ?? [],
    };
  }

  async start(input: WorkflowStartInput): Promise<WorkflowPublicState> {
    const threadId = input.threadId ?? crypto.randomUUID();
    await this.workflow.invoke({
      projectId: input.projectId,
      threadId,
      requestId: input.requestId,
      intent: input.intent ?? "start",
      graphRevision: 0,
      focusNodeId: input.focusNodeId,
      sourceNodeId: input.sourceNodeId,
      targetNodeId: input.targetNodeId,
      growthMode: input.growthMode,
      targetCategory: input.targetCategory,
      candidateCount: input.candidateCount,
      growthInstruction: input.growthInstruction,
      needRag: input.needRag ?? false,
      pendingOperations: [],
      nextAction: input.intent ?? "start",
      repairCount: 0,
      errors: [],
    }, this.config(threadId));
    return this.publicState(threadId);
  }

  async resume(threadId: string, decision: HumanDecision): Promise<WorkflowPublicState> {
    await this.workflow.invoke(new Command({ resume: decision }), this.config(threadId));
    return this.publicState(threadId);
  }

  async getState(threadId: string): Promise<WorkflowPublicState> {
    return this.publicState(threadId);
  }
}
