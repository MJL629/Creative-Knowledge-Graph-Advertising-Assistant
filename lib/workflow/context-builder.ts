import type { CreativeBrief, GraphNode, GraphSnapshot, RetrievalResult } from "../contracts";

function nodeSummary(node: GraphNode) {
  return {
    id: node.id,
    title: node.title ?? node.label,
    description: node.description ?? "",
    category: node.category ?? node.type,
    subtype: node.subtype,
    status: node.status,
    parentId: node.parentId,
    actorRefs: node.actorRefs,
    productFeatureRefs: node.productFeatureRefs,
    attributes: node.attributes,
  };
}

export function buildStartContext(brief: CreativeBrief, retrieval?: RetrievalResult): CreativeBrief {
  return {
    ...brief,
    ideaFragments: brief.ideaFragments.slice(0, 2),
    constraints: {
      ...(brief.constraints ?? {}),
      ...(retrieval ? {
        retrievalSummary: retrieval.hits.slice(0, 5).map((hit) => ({
          id: hit.id,
          title: hit.title,
          content: hit.content.slice(0, 500),
          score: hit.score,
          source: hit.source,
        })),
      } : {}),
    },
  };
}

export function buildGrowthContext(graph: GraphSnapshot, focusNodeId: string) {
  const focus = graph.nodes.find((node) => node.id === focusNodeId);
  if (!focus) return undefined;
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const selected = new Set<string>([focus.id]);
  let parentId = focus.parentId;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    selected.add(parent.id);
    parentId = parent.parentId;
  }
  for (const edge of graph.edges) {
    if (edge.sourceId === focus.id) selected.add(edge.targetId);
    if (edge.targetId === focus.id) selected.add(edge.sourceId);
  }
  for (const node of graph.nodes) {
    if (node.status === "adopted" || node.status === "excluded") selected.add(node.id);
  }
  return {
    focus,
    nodes: graph.nodes.filter((node) => selected.has(node.id)).map(nodeSummary),
    edges: graph.edges
      .filter((edge) => selected.has(edge.sourceId) && selected.has(edge.targetId))
      .map((edge) => ({ source: edge.sourceId, target: edge.targetId, label: edge.label, status: edge.status })),
  };
}

export function buildRelationContext(graph: GraphSnapshot, sourceId: string, targetId: string) {
  const selected = new Set([sourceId, targetId]);
  for (const edge of graph.edges) {
    if (selected.has(edge.sourceId) || selected.has(edge.targetId)) {
      selected.add(edge.sourceId);
      selected.add(edge.targetId);
    }
  }
  return {
    nodes: graph.nodes.filter((node) => selected.has(node.id)).map(nodeSummary),
    edges: graph.edges
      .filter((edge) => selected.has(edge.sourceId) && selected.has(edge.targetId))
      .map((edge) => ({ source: edge.sourceId, target: edge.targetId, label: edge.label, status: edge.status })),
  };
}

export function buildConceptContext(graph: GraphSnapshot) {
  const adoptedIds = new Set(graph.nodes.filter((node) => node.status === "adopted").map((node) => node.id));
  return {
    adoptedNodes: graph.nodes.filter((node) => adoptedIds.has(node.id)).map(nodeSummary),
    adoptedEdges: graph.edges
      .filter((edge) => edge.status === "adopted" && adoptedIds.has(edge.sourceId) && adoptedIds.has(edge.targetId))
      .map((edge) => ({ source: edge.sourceId, target: edge.targetId, label: edge.label, direction: edge.direction })),
  };
}
