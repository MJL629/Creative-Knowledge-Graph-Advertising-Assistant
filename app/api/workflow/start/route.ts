import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getWorkflowRuntime, type WorkflowIntent } from "../../../../lib/workflow";

const intents = new Set<WorkflowIntent>(["start", "grow", "relations", "concept"]);

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await readJsonObject(request);
    const projectId = String(body.projectId ?? "").trim();
    const intent = String(body.intent ?? "start") as WorkflowIntent;
    if (!projectId) return errorJson(ERROR_CODES.VALIDATION_ERROR, "projectId is required", 400, undefined, requestId);
    if (!intents.has(intent)) return errorJson(ERROR_CODES.VALIDATION_ERROR, "Unsupported workflow intent", 400, undefined, requestId);
    const state = await (await getWorkflowRuntime()).start({
      projectId,
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      intent,
      focusNodeId: typeof body.focusNodeId === "string" ? body.focusNodeId : undefined,
      sourceNodeId: typeof body.sourceNodeId === "string" ? body.sourceNodeId : undefined,
      targetNodeId: typeof body.targetNodeId === "string" ? body.targetNodeId : undefined,
      needRag: body.needRag === true,
    });
    return okJson(state, { status: 202 }, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
