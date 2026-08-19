import { getCreativeAgentGateway } from "../agents/creative-agent-gateway";
import { getProjectRepository } from "../repositories";
import { getRetrievalProvider } from "../retrieval";
import { getRuntimeEnv } from "../runtime/env";
import { MemoryWorkflowCheckpointerProvider, PostgresWorkflowCheckpointerProvider } from "./checkpointer";
import { WorkflowRuntime } from "./workflow-runtime";

let runtimePromise: Promise<WorkflowRuntime> | undefined;

async function createRuntime() {
  const env = await getRuntimeEnv();
  const provider = String(env.WORKFLOW_CHECKPOINTER ?? "memory").toLowerCase();
  const checkpointerProvider = provider === "postgres"
    ? await PostgresWorkflowCheckpointerProvider.create(
        env.WORKFLOW_DATABASE_URL ?? env.DATABASE_URL ?? "",
        env.WORKFLOW_CHECKPOINT_SCHEMA ?? "langgraph",
      )
    : provider === "memory"
      ? new MemoryWorkflowCheckpointerProvider()
      : (() => { throw new Error(`Unsupported WORKFLOW_CHECKPOINTER: ${provider}`); })();

  return new WorkflowRuntime({
    repository: getProjectRepository(),
    retrievalProvider: await getRetrievalProvider(),
    agentGateway: getCreativeAgentGateway(),
    checkpointerProvider,
  });
}

export function getWorkflowRuntime() {
  runtimePromise ??= createRuntime();
  return runtimePromise;
}

export * from "./workflow-runtime";
export * from "./workflow-types";
