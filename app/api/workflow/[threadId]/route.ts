import { getRequestId, okJson, routeError } from "../../../../lib/api/response";
import { ERROR_CODES } from "../../../../lib/contracts";
import { getWorkflowRuntime } from "../../../../lib/workflow";

type RouteContext = { params: { threadId: string } | Promise<{ threadId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const { threadId } = await context.params;
    return okJson(await (await getWorkflowRuntime()).getState(threadId), {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
