import { AppError, ERROR_CODES, type CreativeBrief, type GraphCommitRequest, type GraphEdge, type GraphNode, type GraphSnapshot, type GraphStatus, type Project, type ProjectSummary, type StoryVersion } from "../contracts";
import type { ProjectRepository } from "./project-repository";

type Store = {
  projects: Map<string, Project>;
  graphs: Map<string, GraphSnapshot>;
  stories: Map<string, StoryVersion[]>;
  commits: Map<string, { requestHash: string; snapshot: GraphSnapshot }>;
};

const store: Store = {
  projects: new Map(),
  graphs: new Map(),
  stories: new Map(),
  commits: new Map(),
};

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function findNode(snapshot: GraphSnapshot, nodeId: string) {
  const node = snapshot.nodes.find((item) => item.id === nodeId);
  if (!node) throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, `Node not found: ${nodeId}`, 400);
  return node;
}

function findEdge(snapshot: GraphSnapshot, edgeId: string) {
  const edge = snapshot.edges.find((item) => item.id === edgeId);
  if (!edge) throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, `Edge not found: ${edgeId}`, 400);
  return edge;
}

function setNodeStatus(snapshot: GraphSnapshot, nodeId: string, status: GraphStatus, updatedAt: string) {
  findNode(snapshot, nodeId).status = status;
  findNode(snapshot, nodeId).updatedAt = updatedAt;
}

function setEdgeStatus(snapshot: GraphSnapshot, edgeId: string, status: GraphStatus, updatedAt: string) {
  findEdge(snapshot, edgeId).status = status;
  findEdge(snapshot, edgeId).updatedAt = updatedAt;
}

function descendants(snapshot: GraphSnapshot, nodeId: string) {
  const result = new Set<string>();
  const queue = [nodeId];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    for (const node of snapshot.nodes) {
      if (node.parentId === current && !result.has(node.id)) {
        result.add(node.id);
        queue.push(node.id);
      }
    }
  }
  return result;
}

function applyOperation(snapshot: GraphSnapshot, operation: GraphCommitRequest["operations"][number], updatedAt: string) {
  if (!operation || typeof operation !== "object" || typeof (operation as { type?: unknown }).type !== "string") {
    throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "Invalid graph operation", 400);
  }
  switch (operation.type) {
    case "ADD_NODE": {
      const label = String(operation.node.label ?? operation.node.title ?? "").trim();
      if (!label) throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "ADD_NODE requires node.label", 400);
      const id = String(operation.node.id ?? newId("node"));
      if (snapshot.nodes.some((node) => node.id === id)) {
        throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, `Node already exists: ${id}`, 400);
      }
      const nodeType = String(operation.node.type ?? operation.node.category ?? "creative_element");
      const node: GraphNode = {
        id,
        projectId: snapshot.projectId,
        type: nodeType,
        category: nodeType,
        label,
        title: String(operation.node.title ?? label),
        description: operation.node.description ? String(operation.node.description) : undefined,
        subtype: operation.node.subtype ? String(operation.node.subtype) : undefined,
        status: operation.node.status ?? "candidate",
        parentId: operation.node.parentId ?? null,
        depth: Number.isInteger(operation.node.depth) ? Number(operation.node.depth) : 1,
        originalParentId: operation.node.originalParentId ?? null,
        originalDepth: operation.node.originalDepth,
        importance: operation.node.importance,
        position: operation.node.position,
        sourceRefs: operation.node.sourceRefs,
        provenance: operation.node.provenance,
        attributes: operation.node.attributes,
        actorRefs: operation.node.actorRefs,
        productFeatureRefs: operation.node.productFeatureRefs,
        growthMode: operation.node.growthMode,
        createdAt: updatedAt,
        updatedAt,
      };
      snapshot.nodes.push(node);
      return;
    }
    case "ADD_EDGE": {
      const sourceId = String(operation.edge.sourceId ?? operation.edge.source ?? "");
      const targetId = String(operation.edge.targetId ?? operation.edge.target ?? "");
      const label = String(operation.edge.label ?? "").trim();
      if (!sourceId || !targetId || !label) throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "ADD_EDGE requires sourceId, targetId and label", 400);
      findNode(snapshot, sourceId);
      findNode(snapshot, targetId);
      const id = String(operation.edge.id ?? newId("edge"));
      if (snapshot.edges.some((edge) => edge.id === id)) {
        throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, `Edge already exists: ${id}`, 400);
      }
      const edge: GraphEdge = {
        id,
        projectId: snapshot.projectId,
        sourceId,
        targetId,
        source: sourceId,
        target: targetId,
        type: operation.edge.type,
        label,
        status: operation.edge.status ?? "candidate",
        direction: operation.edge.direction,
        sourceRefs: operation.edge.sourceRefs,
        createdAt: updatedAt,
        updatedAt,
      };
      snapshot.edges.push(edge);
      return;
    }
    case "ADOPT_NODE":
      setNodeStatus(snapshot, operation.nodeId, "adopted", updatedAt);
      return;
    case "EXCLUDE_NODE":
      setNodeStatus(snapshot, operation.nodeId, "excluded", updatedAt);
      return;
    case "RESTORE_NODE":
      setNodeStatus(snapshot, operation.nodeId, "candidate", updatedAt);
      return;
    case "UPDATE_NODE": {
      const node = findNode(snapshot, operation.nodeId);
      const patch = operation.patch;
      Object.assign(node, {
        ...patch,
        id: node.id,
        projectId: node.projectId,
        createdAt: node.createdAt,
        updatedAt,
      });
      if (patch.label) node.title = patch.title ?? patch.label;
      if (patch.title) node.label = patch.label ?? patch.title;
      if (patch.type) node.category = patch.type;
      if (patch.category) node.type = patch.category;
      return;
    }
    case "DELETE_NODE": {
      const node = findNode(snapshot, operation.nodeId);
      const idsToDelete = operation.cascade ? descendants(snapshot, operation.nodeId) : new Set<string>();
      idsToDelete.add(operation.nodeId);
      snapshot.nodes = snapshot.nodes
        .filter((item) => !idsToDelete.has(item.id))
        .map((item) => item.parentId === operation.nodeId ? { ...item, parentId: node.parentId ?? null, originalParentId: item.originalParentId ?? item.parentId, updatedAt } : item);
      snapshot.edges = snapshot.edges.filter((edge) => !idsToDelete.has(edge.sourceId) && !idsToDelete.has(edge.targetId));
      return;
    }
    case "ADOPT_EDGE":
      setEdgeStatus(snapshot, operation.edgeId, "adopted", updatedAt);
      return;
    case "EXCLUDE_EDGE":
      setEdgeStatus(snapshot, operation.edgeId, "excluded", updatedAt);
      return;
    case "DELETE_EDGE":
      findEdge(snapshot, operation.edgeId);
      snapshot.edges = snapshot.edges.filter((edge) => edge.id !== operation.edgeId);
      return;
    default:
      throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "Unsupported graph operation", 400);
  }
}

export class MemoryProjectRepository implements ProjectRepository {
  async listProjects(): Promise<ProjectSummary[]> {
    return [...store.projects.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, name, graphRevision, createdAt, updatedAt }) => ({ id, name, graphRevision, createdAt, updatedAt }));
  }

  async createProject(input: { name: string; brief: CreativeBrief }): Promise<Project> {
    const timestamp = nowIso();
    const project: Project = {
      id: newId("project"),
      name: input.name.trim(),
      brief: clone(input.brief),
      graphRevision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.projects.set(project.id, project);
    store.graphs.set(project.id, { projectId: project.id, revision: 0, nodes: [], edges: [] });
    store.stories.set(project.id, []);
    return clone(project);
  }

  async getProject(projectId: string): Promise<Project | null> {
    const project = store.projects.get(projectId);
    return project ? clone(project) : null;
  }

  async updateProject(projectId: string, patch: { name?: string; brief?: CreativeBrief }): Promise<Project | null> {
    const project = store.projects.get(projectId);
    if (!project) return null;
    const updated = { ...project, ...patch, updatedAt: nowIso() };
    store.projects.set(projectId, updated);
    return clone(updated);
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const existed = store.projects.delete(projectId);
    store.graphs.delete(projectId);
    store.stories.delete(projectId);
    for (const key of store.commits.keys()) if (key.startsWith(`${projectId}:`)) store.commits.delete(key);
    return existed;
  }

  async getGraph(projectId: string): Promise<GraphSnapshot | null> {
    const graph = store.graphs.get(projectId);
    return graph ? clone(graph) : null;
  }

  async commitGraph(input: GraphCommitRequest): Promise<GraphSnapshot> {
    const project = store.projects.get(input.projectId);
    if (!project) throw new AppError(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404);
    const current = store.graphs.get(input.projectId);
    if (!current) throw new AppError(ERROR_CODES.GRAPH_NOT_FOUND, "Graph not found", 404);
    const requestHash = JSON.stringify({ expectedRevision: input.expectedRevision, operations: input.operations });
    const idempotencyKey = input.operationId ? `${input.projectId}:${input.operationId}` : undefined;
    const previous = idempotencyKey ? store.commits.get(idempotencyKey) : undefined;
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "operationId was already used with a different request", 409);
      }
      return clone(previous.snapshot);
    }
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== current.revision) {
      throw new AppError(ERROR_CODES.GRAPH_REVISION_CONFLICT, "Graph revision conflict", 409, {
        expectedRevision: input.expectedRevision,
        actualRevision: current.revision,
        snapshot: clone(current),
      });
    }
    if (!Array.isArray(input.operations)) {
      throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, "operations must be an array", 400);
    }

    const updatedAt = nowIso();
    const next = clone(current);
    for (const operation of input.operations) applyOperation(next, operation, updatedAt);
    next.revision += 1;
    next.nodes = next.nodes.map((node) => ({ ...node, projectId: input.projectId }));
    next.edges = next.edges.map((edge) => ({ ...edge, projectId: input.projectId }));
    store.graphs.set(input.projectId, next);
    store.projects.set(input.projectId, { ...project, graphRevision: next.revision, updatedAt });
    if (idempotencyKey) store.commits.set(idempotencyKey, { requestHash, snapshot: clone(next) });
    return clone(next);
  }

  async listStoryVersions(projectId: string): Promise<StoryVersion[] | null> {
    if (!store.projects.has(projectId)) return null;
    return clone(store.stories.get(projectId) ?? []);
  }

  async saveStoryVersion(input: { projectId: string; graphRevision: number; content: unknown }): Promise<StoryVersion | null> {
    if (!store.projects.has(input.projectId)) return null;
    const versions = store.stories.get(input.projectId) ?? [];
    const story: StoryVersion = {
      id: newId("story"),
      projectId: input.projectId,
      version: versions.length + 1,
      graphRevision: input.graphRevision,
      content: input.content,
      createdAt: nowIso(),
    };
    versions.push(story);
    store.stories.set(input.projectId, versions);
    return clone(story);
  }
}
