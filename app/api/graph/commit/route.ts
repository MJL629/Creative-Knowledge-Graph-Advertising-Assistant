import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES, type GraphCommitRequest } from "../../../../lib/contracts";
import { getProjectRepository } from "../../../../lib/repositories";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await readJsonObject(request);
    const projectId = String(body.projectId ?? "").trim();
    const expectedRevision = Number(body.expectedRevision);
    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : undefined;
    if (!projectId) return errorJson(ERROR_CODES.VALIDATION_ERROR, "projectId is required", 400, undefined, requestId);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "expectedRevision must be a non-negative integer", 400, undefined, requestId);
    }
    if (!Array.isArray(body.operations)) {
      return errorJson(ERROR_CODES.GRAPH_OPERATION_INVALID, "operations must be an array", 400, undefined, requestId);
    }

    const snapshot = await getProjectRepository().commitGraph({
      projectId,
      expectedRevision,
      operationId,
      operations: body.operations,
    } as GraphCommitRequest);
    return okJson(snapshot, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
