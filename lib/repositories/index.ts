import type { CreativeBrief, GraphCommitRequest } from "../contracts";
import { AppError, ERROR_CODES } from "../contracts";
import { getRuntimeEnv } from "../runtime/env";
import { MemoryProjectRepository } from "./memory-project-repository";
import { PostgresProjectRepository } from "./postgres-project-repository";
import type { ProjectRepository } from "./project-repository";

const memoryRepository = new MemoryProjectRepository();

async function resolveRepository(): Promise<ProjectRepository> {
  const env = await getRuntimeEnv();
  const provider = String(env.PERSISTENCE_PROVIDER ?? "postgres").toLowerCase();
  if (provider === "memory") {
    if (env.NODE_ENV === "production") {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Production requires PERSISTENCE_PROVIDER=postgres", 503);
    }
    return memoryRepository;
  }
  if (provider !== "postgres") {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Unsupported PERSISTENCE_PROVIDER: ${provider}`, 503);
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, "DATABASE_URL is required when PERSISTENCE_PROVIDER=postgres", 503);
  }
  // Cloudflare Workers bind I/O objects to the request that created them.
  // Never cache a postgres client across requests; memory remains the explicit
  // process-local test fallback.
  return new PostgresProjectRepository(databaseUrl, { max: 1 });
}

async function withRepository<T>(operation: (selected: ProjectRepository) => Promise<T>): Promise<T> {
  const selected = await resolveRepository();
  try {
    return await operation(selected);
  } finally {
    if (selected instanceof PostgresProjectRepository) await selected.close();
  }
}

const repository: ProjectRepository = {
  async listProjects() { return withRepository((selected) => selected.listProjects()); },
  async createProject(input: { name: string; brief: CreativeBrief }) { return withRepository((selected) => selected.createProject(input)); },
  async getProject(projectId: string) { return withRepository((selected) => selected.getProject(projectId)); },
  async updateProject(projectId: string, patch: { name?: string; brief?: CreativeBrief }) { return withRepository((selected) => selected.updateProject(projectId, patch)); },
  async deleteProject(projectId: string) { return withRepository((selected) => selected.deleteProject(projectId)); },
  async getGraph(projectId: string) { return withRepository((selected) => selected.getGraph(projectId)); },
  async commitGraph(input: GraphCommitRequest) { return withRepository((selected) => selected.commitGraph(input)); },
  async listStoryVersions(projectId: string) { return withRepository((selected) => selected.listStoryVersions(projectId)); },
  async saveStoryVersion(input: { projectId: string; graphRevision: number; content: unknown }) { return withRepository((selected) => selected.saveStoryVersion(input)); },
};

export function getProjectRepository(): ProjectRepository {
  return repository;
}

export type { ProjectRepository };
export { MemoryProjectRepository, PostgresProjectRepository };
