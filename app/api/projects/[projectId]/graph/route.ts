import { errorJson, getRequestId, okJson, routeError } from "../../../../../lib/api/response";
import { ERROR_CODES } from "../../../../../lib/contracts";
import { getProjectRepository } from "../../../../../lib/repositories";

type RouteContext = { params: { projectId: string } | Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const { projectId } = await context.params;
    const project = await getProjectRepository().getProject(projectId);
    if (!project) return errorJson(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404, undefined, requestId);
    const graph = await getProjectRepository().getGraph(projectId);
    if (!graph) return errorJson(ERROR_CODES.GRAPH_NOT_FOUND, "Graph not found", 404, undefined, requestId);
    return okJson(graph, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
