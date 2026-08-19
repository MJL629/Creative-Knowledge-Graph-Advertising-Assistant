import {
  AppError,
  ERROR_CODES,
  type GraphCommitOperation,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type GraphStatus,
} from "../contracts";

const NODE_STATUSES = new Set<GraphStatus>(["candidate", "adopted", "excluded", "needs_review"]);
const SYSTEM_NODE_FIELDS = new Set(["id", "projectId", "createdAt", "updatedAt", "revision"]);

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalid(message: string): never {
  throw new AppError(ERROR_CODES.GRAPH_OPERATION_INVALID, message, 400);
}

function findNode(snapshot: GraphSnapshot, nodeId: string) {
  const node = snapshot.nodes.find((item) => item.id === nodeId);
  if (!node) invalid(`Node not found: ${nodeId}`);
  return node;
}

function findEdge(snapshot: GraphSnapshot, edgeId: string) {
  const edge = snapshot.edges.find((item) => item.id === edgeId);
  if (!edge) invalid(`Edge not found: ${edgeId}`);
  return edge;
}

function validateStatus(status: unknown): asserts status is GraphStatus {
  if (typeof status !== "string" || !NODE_STATUSES.has(status as GraphStatus)) {
    invalid(`Invalid graph status: ${String(status)}`);
  }
}

function setNodeStatus(snapshot: GraphSnapshot, nodeId: string, status: GraphStatus, updatedAt: string) {
  const node = findNode(snapshot, nodeId);
  node.status = status;
  node.updatedAt = updatedAt;
}

function setEdgeStatus(snapshot: GraphSnapshot, edgeId: string, status: GraphStatus, updatedAt: string) {
  const edge = findEdge(snapshot, edgeId);
  edge.status = status;
  edge.updatedAt = updatedAt;
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

function assertParentIsValid(snapshot: GraphSnapshot, nodeId: string, parentId: string | null | undefined) {
  if (!parentId) return;
  if (parentId === nodeId) invalid("A node cannot be its own parent");
  findNode(snapshot, parentId);
  if (descendants(snapshot, nodeId).has(parentId)) invalid("A node cannot be moved under its descendant");
}

function applyOperation(snapshot: GraphSnapshot, operation: GraphCommitOperation, updatedAt: string) {
  if (!operation || typeof operation !== "object" || typeof (operation as { type?: unknown }).type !== "string") {
    invalid("Invalid graph operation");
  }

  switch (operation.type) {
    case "ADD_NODE": {
      const label = String(operation.node.label ?? operation.node.title ?? "").trim();
      if (!label) invalid("ADD_NODE requires node.label");
      const id = String(operation.node.id ?? newId("node"));
      if (snapshot.nodes.some((node) => node.id === id)) invalid(`Node already exists: ${id}`);
      const parentId = operation.node.parentId ?? null;
      if (parentId) findNode(snapshot, parentId);
      const status = operation.node.status ?? "candidate";
      validateStatus(status);
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
        status,
        parentId,
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
      if (!sourceId || !targetId || !label) invalid("ADD_EDGE requires sourceId, targetId and label");
      if (sourceId === targetId) invalid("ADD_EDGE cannot connect a node to itself");
      findNode(snapshot, sourceId);
      findNode(snapshot, targetId);
      const id = String(operation.edge.id ?? newId("edge"));
      if (snapshot.edges.some((edge) => edge.id === id)) invalid(`Edge already exists: ${id}`);
      const status = operation.edge.status ?? "candidate";
      if (status !== "pending") validateStatus(status);
      const edge: GraphEdge = {
        id,
        projectId: snapshot.projectId,
        sourceId,
        targetId,
        source: sourceId,
        target: targetId,
        type: operation.edge.type,
        label,
        status,
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
      const patchRecord = operation.patch as Record<string, unknown>;
      const forbidden = Object.keys(patchRecord).find((key) => SYSTEM_NODE_FIELDS.has(key));
      if (forbidden) invalid(`UPDATE_NODE cannot change system field: ${forbidden}`);
      const node = findNode(snapshot, operation.nodeId);
      if ("status" in patchRecord) validateStatus(patchRecord.status);
      if ("parentId" in patchRecord) assertParentIsValid(snapshot, node.id, operation.patch.parentId);
      Object.assign(node, operation.patch, { id: node.id, projectId: node.projectId, createdAt: node.createdAt, updatedAt });
      if (operation.patch.label) node.title = operation.patch.title ?? operation.patch.label;
      if (operation.patch.title) node.label = operation.patch.label ?? operation.patch.title;
      if (operation.patch.type) node.category = operation.patch.type;
      if (operation.patch.category) node.type = operation.patch.category;
      return;
    }
    case "DELETE_NODE": {
      const node = findNode(snapshot, operation.nodeId);
      const idsToDelete = operation.cascade ? descendants(snapshot, operation.nodeId) : new Set<string>();
      idsToDelete.add(operation.nodeId);
      snapshot.nodes = snapshot.nodes
        .filter((item) => !idsToDelete.has(item.id))
        .map((item) => item.parentId === operation.nodeId
          ? {
              ...item,
              parentId: node.parentId ?? null,
              originalParentId: item.originalParentId ?? item.parentId,
              originalDepth: item.originalDepth ?? item.depth,
              depth: Math.max(0, item.depth - 1),
              updatedAt,
            }
          : item);
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
      invalid("Unsupported graph operation");
  }
}

export function applyGraphOperations(snapshot: GraphSnapshot, operations: GraphCommitOperation[], updatedAt: string) {
  if (!Array.isArray(operations)) invalid("operations must be an array");
  const next = clone(snapshot);
  for (const operation of operations) applyOperation(next, operation, updatedAt);
  next.nodes = next.nodes.map((node) => ({ ...node, projectId: snapshot.projectId }));
  next.edges = next.edges.map((edge) => ({ ...edge, projectId: snapshot.projectId }));
  return next;
}
