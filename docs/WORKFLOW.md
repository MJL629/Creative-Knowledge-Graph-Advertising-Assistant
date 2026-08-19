# Creative workflow

The workflow is an explicit LangGraph `StateGraph`. It coordinates existing repository, retrieval, and creative-agent boundaries; it does not replace their business logic.

## State and service boundaries

`CreativeState` contains only serializable values: project/thread identifiers, intent, brief, graph revision and snapshot, retrieval results, candidates, validation, pending graph operations, human decision, and errors. Repository instances, database clients, model clients, and retrievers are injected into `createCreativeWorkflow` and never checkpointed.

`projectId` identifies durable business data. `threadId` identifies one workflow execution; a project can have multiple threads.

## Flow

```text
load project -> plan context -> optional retrieval -> intent router
  start     -> divergence -> validate -> interrupt
  grow      -> growth     -> validate -> interrupt
  relations -> suggestion -> validate -> interrupt
  concept   -> reload adopted subgraph -> story -> end

interrupt -> UI decision -> resume -> repository commit -> next action or end
```

Candidates and relation suggestions are never written automatically. `resume` receives a `HumanDecision`; every graph mutation still goes through `ProjectRepository.commitGraph` with `expectedRevision`. A concurrent edit therefore returns the existing 409 revision conflict and latest snapshot.

`action=commit` commits and ends. It never triggers growth. `action=grow`, `relations`, or `concept` may commit selected operations first and then continue to that explicit next step.

Story convergence reloads the latest graph and passes only adopted nodes plus adopted edges whose endpoints are also adopted.

## APIs

- `POST /api/workflow/start` - `{ projectId, threadId?, intent?, focusNodeId?, sourceNodeId?, targetNodeId?, needRag? }`
- `POST /api/workflow/resume` - `{ threadId, decision }`
- `GET /api/workflow/:threadId` - inspect checkpointed public state

The original `/api/graph/diverge`, `/grow`, `/relations`, and `/concept` contracts remain available. New orchestration clients should use the workflow endpoints.

## Checkpoints

Local tests may use `MemorySaver`. Production requires the PostgreSQL checkpointer and keeps workflow execution state separate from business tables (`projects`, `graph_nodes`, `graph_edges`, and `story_versions`). The durable integration test recreates both repository and runtime, reloads the paused thread, and resumes without rerunning initial divergence.

Model and retrieval calls emit best-effort traces keyed by `requestId`, `threadId`, and `projectId`. Trace persistence never blocks graph commits. Retrieval failure is recorded and routed through the non-RAG path without changing the confirmed graph.
