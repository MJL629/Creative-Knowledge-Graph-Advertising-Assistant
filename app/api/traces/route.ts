import { errorJson, getRequestId, okJson, routeError } from "../../../lib/api/response";
import { ERROR_CODES } from "../../../lib/contracts";
import { listTraces } from "../../../lib/observability/trace";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const url = new URL(request.url);
    const query = {
      requestId: url.searchParams.get("requestId") ?? undefined,
      threadId: url.searchParams.get("threadId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? 100),
    };
    if (!query.requestId && !query.threadId && !query.projectId) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "requestId, threadId or projectId is required", 400, undefined, requestId);
    }
    return okJson(await listTraces(query), {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
