import type { CreativeBrief } from "./creative-brief";

export interface Project {
  id: string;
  name: string;
  brief: CreativeBrief;
  graphRevision: number;
  createdAt: string;
  updatedAt: string;
}

export type ProjectSummary = Pick<Project, "id" | "name" | "graphRevision" | "createdAt" | "updatedAt">;
