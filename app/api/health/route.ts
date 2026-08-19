import { okJson } from "../../../lib/api/response";
import { getRuntimeEnv } from "../../../lib/runtime/env";
import { getProjectRepository } from "../../../lib/repositories";

export async function GET(request: Request) {
  const runtimeEnv = await getRuntimeEnv();
  const persistenceProvider = String(runtimeEnv.PERSISTENCE_PROVIDER ?? "memory").toLowerCase();
  let persistence: string = persistenceProvider;
  try {
    await getProjectRepository().listProjects();
  } catch {
    persistence = "unavailable";
  }
  const modelProvider = String(runtimeEnv.CREATIVE_MODEL_PROVIDER ?? "deepseek").toLowerCase();
  const modelConfigured = modelProvider === "mock" || Boolean(runtimeEnv.OPENAI_API_KEY ?? runtimeEnv.DEEPSEEK_API_KEY);
  const retrievalProvider = String(runtimeEnv.RETRIEVAL_PROVIDER ?? "mock").toLowerCase();
  const retrieval = retrievalProvider === "real" && !runtimeEnv.RETRIEVAL_ENDPOINT ? "unavailable" : retrievalProvider;
  const checkpointer = String(runtimeEnv.WORKFLOW_CHECKPOINTER ?? "memory").toLowerCase();
  const workflow = checkpointer === "postgres" && !(runtimeEnv.WORKFLOW_DATABASE_URL ?? runtimeEnv.DATABASE_URL) ? "degraded" : "ok";
  return okJson({
    application: "ok",
    persistence,
    workflow,
    modelProvider: modelConfigured ? "configured" : "missing",
    retrievalProvider: retrieval,
  }, {}, request.headers.get("x-request-id") ?? undefined);
}
