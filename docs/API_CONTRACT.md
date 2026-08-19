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

`VALIDATION_ERROR`, `PROJECT_NOT_FOUND`, `GRAPH_NOT_FOUND`, `GRAPH_REVISION_CONFLICT`, `GRAPH_OPERATION_INVALID`, `GRAPH_DIVERGENCE_FAILED`, `GROWTH_INPUT_INVALID`, `GRAPH_GROWTH_FAILED`, `RELATIONS_INPUT_INVALID`, `RELATIONS_FAILED`, `CONCEPT_INPUT_INVALID`, `CONCEPT_FAILED`, `PROVIDER_TIMEOUT`, `RETRIEVAL_UNAVAILABLE`, `RETRIEVAL_INVALID_RESPONSE`, `CHECKPOINT_UNAVAILABLE`, `STORY_NOT_FOUND`, `INTERNAL_ERROR`.

## APIs

- `GET /api/health`: service health and non-secret provider names.
- `GET /api/projects`: list project summaries.
- `POST /api/projects`: create a project from `{ "name": "...", "brief": { ... } }`.
- `GET /api/projects/:projectId`: get one project.
- `PATCH /api/projects/:projectId`: update `name` and/or `brief`.
- `DELETE /api/projects/:projectId`: delete the project and cascade its graph, stories, and idempotency records.
- `GET /api/projects/:projectId/graph`: read the current graph snapshot.
- `POST /api/graph/commit`: apply graph operations with optimistic revision control.
- `GET /api/projects/:projectId/stories`: list story versions.
- `POST /api/projects/:projectId/stories`: save a story version from `{ "graphRevision": 1, "content": { ... } }`.
- `POST /api/workflow/start`: start `start|grow|relations|concept` orchestration and return its public checkpoint state.
- `POST /api/workflow/resume`: resume a paused thread with a typed human decision.
- `GET /api/workflow/:threadId`: reload paused/completed public state.
- `GET /api/traces?requestId=...|threadId=...|projectId=...`: query non-prompt execution metadata.
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

`POST /api/graph/commit` requires `expectedRevision`. Optional `operationId` makes retries idempotent: an identical replay returns the first snapshot, while different content using the same id is rejected. If the server graph revision equals it, all operations are applied transactionally and the revision increments by 1. If the server revision has moved, the API returns `409 GRAPH_REVISION_CONFLICT` with `expectedRevision`, `actualRevision` and the latest snapshot in `details`.

## Graph Commit Operation

Core operations:

- `ADOPT_NODE`, `EXCLUDE_NODE`, `RESTORE_NODE`
- `UPDATE_NODE`
- `DELETE_NODE` with `cascade: false` (current only; children move to the deleted node's parent) or `cascade: true` (whole descendant branch)
- `ADOPT_EDGE`, `EXCLUDE_EDGE`, `DELETE_EDGE`

Mock integration extensions:

- `ADD_NODE`
- `ADD_EDGE`

Example:

```json
{
  "projectId": "project_xxx",
  "expectedRevision": 0,
  "operationId": "client-generated-stable-id",
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

A implements `RetrievalProvider` from `lib/contracts/retrieval.ts`. `HttpRetrievalProvider` is the production adapter selected by `RETRIEVAL_PROVIDER=real`; `MockRetrievalProvider` remains for tests.

B implements `CreativeAgentGateway` from `lib/contracts/agent.ts`. The current `PipelineCreativeAgentGateway` adapts the existing pipelines without rewriting prompts.

D uses Project/Graph/Story APIs as the source of truth and Workflow start/resume for AI actions. localStorage contains only the current project/thread pointers and is never the formal graph store.

## Mock Usage

Set `CREATIVE_MODEL_PROVIDER=mock` for offline agent routes. Memory Repository/Checkpoint providers are local-test options; production refuses them and requires PostgreSQL.
