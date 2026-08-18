# API Contract

Phase C0 freezes a thin integration contract around the existing demo. The current persistence adapter is `MemoryProjectRepository`; it is for local integration and tests only, and data may be lost when the Worker restarts.

## Domain Model

Canonical TypeScript contracts live in `lib/contracts/`.

- `CreativeBrief`: product, known facts, idea fragments, keep/forbidden constraints, plus compatibility fields used by the demo.
- `Project`: project id, name, brief, graph revision, timestamps.
- `GraphNode`: semantic node plus business-owned id, status, position, revision-independent timestamps.
- `GraphEdge`: semantic edge plus business-owned id, status and timestamps.
- `GraphSnapshot`: project id, revision, nodes and edges.
- `StoryVersion`: versioned story content bound to `projectId` and `graphRevision`.
- `RetrievalResult`: retrieval query and ranked hits.
- `AgentTrace`: shared future trace shape for all agents.

LLM/agent code only generates semantic fields. Business code owns `id`, `projectId`, `status`, `position`, `revision`, `version`, `createdAt` and `updatedAt`.

## Common Response

Success:

```json
{ "ok": true, "result": {} }
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "human readable message",
    "details": {}
  }
}
```

## Error Code

`VALIDATION_ERROR`, `PROJECT_NOT_FOUND`, `GRAPH_NOT_FOUND`, `GRAPH_REVISION_CONFLICT`, `GRAPH_OPERATION_INVALID`, `GRAPH_DIVERGENCE_FAILED`, `GROWTH_INPUT_INVALID`, `GRAPH_GROWTH_FAILED`, `RELATIONS_INPUT_INVALID`, `RELATIONS_FAILED`, `CONCEPT_INPUT_INVALID`, `CONCEPT_FAILED`, `STORY_NOT_FOUND`, `INTERNAL_ERROR`.

## APIs

- `GET /api/health`: service health and non-secret provider names.
- `GET /api/projects`: list project summaries.
- `POST /api/projects`: create a project from `{ "name": "...", "brief": { ... } }`.
- `GET /api/projects/:projectId`: get one project.
- `PATCH /api/projects/:projectId`: update `name` and/or `brief`.
- `DELETE /api/projects/:projectId`: delete the project and its memory graph/stories.
- `GET /api/projects/:projectId/graph`: read the current graph snapshot.
- `POST /api/graph/commit`: apply graph operations with optimistic revision control.
- `GET /api/projects/:projectId/stories`: list story versions.
- `POST /api/projects/:projectId/stories`: save a story version from `{ "graphRevision": 1, "content": { ... } }`.
- Existing agent APIs remain: `POST /api/graph/diverge`, `POST /api/graph/grow`, `POST /api/graph/relations`, `POST /api/graph/concept`.

## Request Example

```json
{
  "name": "夏日水枪节广告创意",
  "brief": {
    "product": "夏日水枪节",
    "ideaFragments": ["透明王冠", "倒计时挑战"]
  }
}
```

## Response Example

```json
{
  "ok": true,
  "result": {
    "id": "project_xxx",
    "name": "夏日水枪节广告创意",
    "graphRevision": 0
  }
}
```

## Revision Mechanism

`POST /api/graph/commit` requires `expectedRevision`. If the server graph revision equals it, all operations are applied against a cloned snapshot and the revision increments by 1. If the server revision has moved, the API returns `409 GRAPH_REVISION_CONFLICT` with `expectedRevision`, `actualRevision` and the latest snapshot in `details`.

## Graph Commit Operation

Core operations:

- `ADOPT_NODE`, `EXCLUDE_NODE`, `RESTORE_NODE`
- `UPDATE_NODE`
- `DELETE_NODE`
- `ADOPT_EDGE`, `EXCLUDE_EDGE`, `DELETE_EDGE`

Mock integration extensions:

- `ADD_NODE`
- `ADD_EDGE`

Example:

```json
{
  "projectId": "project_xxx",
  "expectedRevision": 0,
  "operations": [
    {
      "type": "ADD_NODE",
      "node": {
        "label": "水枪国王",
        "type": "creative_element",
        "description": "活动主角"
      }
    }
  ]
}
```

## A/B/D Integration

A implements `RetrievalProvider` from `lib/contracts/retrieval.ts`. Until then, use `MockRetrievalProvider`.

B implements `CreativeAgentGateway` from `lib/contracts/agent.ts`. The current `PipelineCreativeAgentGateway` adapts the existing pipelines without rewriting prompts.

D should depend on these API responses and `tests/fixtures/*.json`. The existing localStorage demo remains intact for C0, but server graph APIs are now available for integration.

## Mock Usage

Set `CREATIVE_MODEL_PROVIDER=mock` for offline agent routes. Repository data is memory-only and suitable for local tests or one Worker process.
