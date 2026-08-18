export type GraphStatus = "candidate" | "adopted" | "excluded" | "needs_review";
export type GraphEdgeStatus = GraphStatus | "pending";
export type GraphNodeCategory = "creative_element" | "motivation_conflict" | "story_event" | string;

export interface GraphNode {
  id: string;
  projectId: string;
  type: GraphNodeCategory;
  subtype?: string;
  label: string;
  description?: string;
  status: GraphStatus;
  parentId?: string | null;
  depth: number;
  originalParentId?: string | null;
  originalDepth?: number;
  importance?: number;
  position?: {
    x: number;
    y: number;
  };
  sourceRefs?: string[];
  createdAt: string;
  updatedAt: string;

  // Current demo compatibility fields.
  category?: GraphNodeCategory;
  title?: string;
  provenance?: string;
  attributes?: Record<string, string | string[]>;
  actorRefs?: string[];
  productFeatureRefs?: string[];
  growthMode?: string;
}

export interface GraphEdge {
  id: string;
  projectId: string;
  sourceId: string;
  targetId: string;
  type?: string;
  label: string;
  status: GraphEdgeStatus;
  sourceRefs?: string[];
  createdAt: string;
  updatedAt: string;

  // Current demo compatibility fields.
  source?: string;
  target?: string;
  direction?: "forward" | "reverse" | "both";
}

export interface GraphSnapshot {
  projectId: string;
  revision: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type AddNodeOperation = {
  type: "ADD_NODE";
  node: Partial<GraphNode> & { label?: string; title?: string; type?: string; category?: string };
};

export type AddEdgeOperation = {
  type: "ADD_EDGE";
  edge: Partial<GraphEdge> & {
    sourceId?: string;
    targetId?: string;
    source?: string;
    target?: string;
    label: string;
  };
};

export type GraphCommitOperation =
  | AddNodeOperation
  | AddEdgeOperation
  | { type: "ADOPT_NODE"; nodeId: string }
  | { type: "EXCLUDE_NODE"; nodeId: string }
  | { type: "RESTORE_NODE"; nodeId: string }
  | { type: "UPDATE_NODE"; nodeId: string; patch: Partial<Omit<GraphNode, "id" | "projectId" | "createdAt" | "updatedAt">> }
  | { type: "DELETE_NODE"; nodeId: string; cascade?: boolean }
  | { type: "ADOPT_EDGE"; edgeId: string }
  | { type: "EXCLUDE_EDGE"; edgeId: string }
  | { type: "DELETE_EDGE"; edgeId: string };

export interface GraphCommitRequest {
  projectId: string;
  expectedRevision: number;
  operations: GraphCommitOperation[];
}
