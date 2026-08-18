import { errorJson, getRequestId, okJson, readJsonObject, routeError } from "../../../lib/api/response";
import { ERROR_CODES, normalizeCreativeBrief } from "../../../lib/contracts";
import { getProjectRepository } from "../../../lib/repositories";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const projects = await getProjectRepository().listProjects();
    return okJson(projects, {}, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.INTERNAL_ERROR, 500, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const body = await readJsonObject(request);
    const name = String(body.name ?? "").trim();
    if (!name) return errorJson(ERROR_CODES.VALIDATION_ERROR, "Project name is required", 400, undefined, requestId);
    const brief = normalizeCreativeBrief(body.brief);
    const project = await getProjectRepository().createProject({ name, brief });
    return okJson(project, { status: 201 }, requestId);
  } catch (error) {
    return routeError(error, ERROR_CODES.VALIDATION_ERROR, 400, requestId);
  }
}
