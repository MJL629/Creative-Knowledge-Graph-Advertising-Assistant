import type { CreativeBrief, GraphCommitRequest, GraphSnapshot, Project, ProjectSummary, StoryVersion } from "../contracts";

export interface ProjectRepository {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(input: { name: string; brief: CreativeBrief }): Promise<Project>;
  getProject(projectId: string): Promise<Project | null>;
  updateProject(projectId: string, patch: { name?: string; brief?: CreativeBrief }): Promise<Project | null>;
  deleteProject(projectId: string): Promise<boolean>;
  getGraph(projectId: string): Promise<GraphSnapshot | null>;
  commitGraph(input: GraphCommitRequest): Promise<GraphSnapshot>;
  listStoryVersions(projectId: string): Promise<StoryVersion[] | null>;
  saveStoryVersion(input: { projectId: string; graphRevision: number; content: unknown }): Promise<StoryVersion | null>;
}
