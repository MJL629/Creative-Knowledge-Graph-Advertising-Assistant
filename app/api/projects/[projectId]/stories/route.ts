import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../../lib/api/response";
import { ERROR_CODES } from "../../../../../lib/contracts";
import { getProjectRepository } from "../../../../../lib/repositories";

type RouteContext = { params: { projectId: string } | Promise<{ projectId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const { projectId } = await context.params;
    const stories = await getProjectRepository().listStoryVersions(projectId);
    if (!stories) return errorJson(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404, undefined, requestId);
    return okJson(stories, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const { projectId } = await context.params;
    const body = await readJsonObject(request);
    const graphRevision = Number(body.graphRevision);
    if (!Number.isInteger(graphRevision) || graphRevision < 0) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "graphRevision must be a non-negative integer", 400, undefined, requestId);
    }
    if (!("content" in body)) {
      return errorJson(ERROR_CODES.VALIDATION_ERROR, "content is required", 400, undefined, requestId);
    }
    const story = await getProjectRepository().saveStoryVersion({
      projectId,
      graphRevision,
      content: body.content,
    });
    if (!story) return errorJson(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404, undefined, requestId);
    return okJson(story, { status: 201 }, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.VALIDATION_ERROR, 400, requestId);
  }
}
