import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getWorkflowRuntime, type WorkflowGrowthMode, type WorkflowIntent } from "../../../../lib/workflow";

const intents = new Set<WorkflowIntent>(["start", "grow", "relations", "concept"]);
const growthModes = new Set<WorkflowGrowthMode>(["deepen", "next_event", "add_conflict", "add_element", "twist", "parallel"]);

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
      requestId,
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      intent,
      focusNodeId: typeof body.focusNodeId === "string" ? body.focusNodeId : undefined,
      sourceNodeId: typeof body.sourceNodeId === "string" ? body.sourceNodeId : undefined,
      targetNodeId: typeof body.targetNodeId === "string" ? body.targetNodeId : undefined,
      needRag: body.needRag === true,
      growthMode: growthModes.has(String(body.growthMode) as WorkflowGrowthMode) ? String(body.growthMode) as WorkflowGrowthMode : undefined,
      targetCategory: typeof body.targetCategory === "string" ? body.targetCategory : undefined,
      candidateCount: body.candidateCount === 3 ? 3 : body.candidateCount === 2 ? 2 : undefined,
      growthInstruction: typeof body.growthInstruction === "string" ? body.growthInstruction : undefined,
    });
    return okJson(state, { status: 202 }, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
