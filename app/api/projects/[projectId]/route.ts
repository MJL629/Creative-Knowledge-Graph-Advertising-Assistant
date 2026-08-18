import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../../lib/api/response";
import { ERROR_CODES, normalizeCreativeBrief } from "../../../../lib/contracts";
import { getProjectRepository } from "../../../../lib/repositories";

type RouteContext = { params: { projectId: string } | Promise<{ projectId: string }> };

async function getProjectId(context: RouteContext) {
  const params = await context.params;
  return params.projectId;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const projectId = await getProjectId(context);
    const project = await getProjectRepository().getProject(projectId);
    if (!project) return errorJson(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404, undefined, requestId);
    return okJson(project, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const projectId = await getProjectId(context);
    const body = await readJsonObject(request);
    const patch: { name?: string; brief?: ReturnType<typeof normalizeCreativeBrief> } = {};
    if ("name" in body) {
      const name = String(body.name ?? "").trim();
      if (!name) return errorJson(ERROR_CODES.VALIDATION_ERROR, "Project name is required", 400, undefined, requestId);
      patch.name = name;
    }
    if ("brief" in body) patch.brief = normalizeCreativeBrief(body.brief);
    const project = await getProjectRepository().updateProject(projectId, patch);
    if (!project) return errorJson(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404, undefined, requestId);
    return okJson(project, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.VALIDATION_ERROR, 400, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const projectId = await getProjectId(context);
    const deleted = await getProjectRepository().deleteProject(projectId);
    if (!deleted) return errorJson(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404, undefined, requestId);
    return okJson({ deleted: true }, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}
