import type { GraphSnapshot, Project, ProjectSummary } from "../contracts";

export type { GraphSnapshot, Project, ProjectSummary } from "../contracts";

export type ApiEnvelope<T> = {
  ok: boolean;
  result: T;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: Record<string, unknown>;

  constructor(status: number, message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface WorkflowStateEnvelope {
  projectId: string;
  threadId: string;
  intent: string;
  graphRevision: number;
  focusNodeId?: string;
  sourceNodeId?: string;
  targetNodeId?: string;
  graphSnapshot?: GraphSnapshot;
  candidateResult?: unknown;
  next: string[];
  interrupts: unknown[];
  errors: string[];
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 20000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
    if (!response.ok || !payload?.ok) {
      throw new ApiError(
        response.status,
        payload?.error?.message || `请求失败（${response.status}）`,
        payload?.error?.code,
        payload?.error?.details,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(408, "请求超时，请重试", "REQUEST_TIMEOUT");
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function listProjects() {
  return apiFetch<ProjectSummary[]>("/api/projects");
}

export function createProject(input: { name: string; brief: Record<string, unknown> }) {
  return apiFetch<ProjectSummary>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getProject(projectId: string) {
  return apiFetch<Project>(`/api/projects/${projectId}`);
}

export function updateProject(
  projectId: string,
  patch: { name?: string; brief?: Record<string, unknown> },
) {
  return apiFetch<Project>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteProject(projectId: string) {
  return apiFetch<{ deleted: boolean }>(`/api/projects/${projectId}`, { method: "DELETE" });
}

export function getGraphSnapshot(projectId: string) {
  return apiFetch<GraphSnapshot>(`/api/projects/${projectId}/graph`);
}

export function commitGraph(body: {
  projectId: string;
  expectedRevision: number;
  operationId?: string;
  operations: unknown[];
}) {
  return apiFetch<GraphSnapshot>("/api/graph/commit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function startWorkflow(input: Record<string, unknown>) {
  return apiFetch<WorkflowStateEnvelope>("/api/workflow/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resumeWorkflow(input: Record<string, unknown>) {
  return apiFetch<WorkflowStateEnvelope>("/api/workflow/resume", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getWorkflowThread(threadId: string) {
  return apiFetch<WorkflowStateEnvelope>(`/api/workflow/${threadId}`);
}

export function listStories(projectId: string) {
  return apiFetch<Array<{ content: unknown }>>(`/api/projects/${projectId}/stories`);
}

export function saveStory(projectId: string, body: { graphRevision: number; content: unknown }) {
  return apiFetch<{ version: number }>(`/api/projects/${projectId}/stories`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
