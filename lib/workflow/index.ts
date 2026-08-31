import { getCreativeAgentGateway } from "../agents/creative-agent-gateway";
import { getProjectRepository } from "../repositories";
import { getRetrievalProvider } from "../retrieval";
import { getRuntimeEnv } from "../runtime/env";
import { MemoryWorkflowCheckpointerProvider, PostgresWorkflowCheckpointerProvider } from "./checkpointer";
import { WorkflowRuntime } from "./workflow-runtime";

let memoryRuntimePromise: Promise<WorkflowRuntime> | undefined;

async function createRuntime() {
  const env = await getRuntimeEnv();
  const provider = String(env.WORKFLOW_CHECKPOINTER ?? "postgres").toLowerCase();
  if (env.NODE_ENV === "production" && provider !== "postgres") {
    throw new Error("Production requires WORKFLOW_CHECKPOINTER=postgres");
  }
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

export async function getWorkflowRuntime() {
  const env = await getRuntimeEnv();
  const provider = String(env.WORKFLOW_CHECKPOINTER ?? "postgres").toLowerCase();
  // PostgresSaver owns I/O and cannot cross Cloudflare request contexts.
  // A durable checkpoint makes a fresh runtime safe for every request.
  if (provider === "postgres") return createRuntime();
  memoryRuntimePromise ??= createRuntime();
  return memoryRuntimePromise;
}

export * from "./workflow-runtime";
export * from "./workflow-types";
