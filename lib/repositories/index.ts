import type { CreativeBrief, GraphCommitRequest } from "../contracts";
import { AppError, ERROR_CODES } from "../contracts";
import { getRuntimeEnv } from "../runtime/env";
import { MemoryProjectRepository } from "./memory-project-repository";
import { PostgresProjectRepository } from "./postgres-project-repository";
import type { ProjectRepository } from "./project-repository";

const memoryRepository = new MemoryProjectRepository();
const postgresRepositories = new Map<string, PostgresProjectRepository>();

async function resolveRepository(): Promise<ProjectRepository> {
  const env = await getRuntimeEnv();
  const provider = String(env.PERSISTENCE_PROVIDER ?? "memory").toLowerCase();
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
  let selected = postgresRepositories.get(databaseUrl);
  if (!selected) {
    selected = new PostgresProjectRepository(databaseUrl);
    postgresRepositories.set(databaseUrl, selected);
  }
  return selected;
}

const repository: ProjectRepository = {
  async listProjects() { return (await resolveRepository()).listProjects(); },
  async createProject(input: { name: string; brief: CreativeBrief }) { return (await resolveRepository()).createProject(input); },
  async getProject(projectId: string) { return (await resolveRepository()).getProject(projectId); },
  async updateProject(projectId: string, patch: { name?: string; brief?: CreativeBrief }) { return (await resolveRepository()).updateProject(projectId, patch); },
  async deleteProject(projectId: string) { return (await resolveRepository()).deleteProject(projectId); },
  async getGraph(projectId: string) { return (await resolveRepository()).getGraph(projectId); },
  async commitGraph(input: GraphCommitRequest) { return (await resolveRepository()).commitGraph(input); },
  async listStoryVersions(projectId: string) { return (await resolveRepository()).listStoryVersions(projectId); },
  async saveStoryVersion(input: { projectId: string; graphRevision: number; content: unknown }) { return (await resolveRepository()).saveStoryVersion(input); },
};

export function getProjectRepository(): ProjectRepository {
  return repository;
}

export type { ProjectRepository };
export { MemoryProjectRepository, PostgresProjectRepository };
