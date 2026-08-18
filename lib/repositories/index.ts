import { MemoryProjectRepository } from "./memory-project-repository";
import type { ProjectRepository } from "./project-repository";

const repository = new MemoryProjectRepository();

export function getProjectRepository(): ProjectRepository {
  // C0 integration adapter only: data is process-local and may disappear after Worker restart.
  return repository;
}

export type { ProjectRepository };
