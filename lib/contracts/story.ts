export interface StoryVersion {
  id: string;
  projectId: string;
  version: number;
  graphRevision: number;
  content: unknown;
  createdAt: string;
}
