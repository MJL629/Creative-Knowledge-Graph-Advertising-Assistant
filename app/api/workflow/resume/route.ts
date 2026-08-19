import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getWorkflowRuntime, type HumanDecision } from "../../../../lib/workflow";

const actions = new Set(["commit", "grow", "relations", "concept", "stop"]);

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await readJsonObject(request);
    const threadId = String(body.threadId ?? "").trim();
    if (!threadId) return errorJson(ERROR_CODES.VALIDATION_ERROR, "threadId is required", 400, undefined, requestId);
    if (!body.decision || typeof body.decision !== "object" || Array.isArray(body.decision)) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "decision is required", 400, undefined, requestId);
    }
    const decision = body.decision as Record<string, unknown>;
    if (!actions.has(String(decision.action)) || ("operations" in decision && !Array.isArray(decision.operations))) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "Invalid human decision", 400, undefined, requestId);
    }
    const state = await (await getWorkflowRuntime()).resume(threadId, decision as HumanDecision);
    return okJson(state, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
