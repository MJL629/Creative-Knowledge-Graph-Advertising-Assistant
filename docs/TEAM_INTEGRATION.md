# Team Integration

## A Knowledge & RAG

Implement `RetrievalProvider` in `lib/contracts/retrieval.ts`.

Use `tests/fixtures/sample-retrieval-result.json` and `MockRetrievalProvider` while pgvector/RAG is not ready. A should not change API routes to add retrieval.

## B LLM & Agent

Implement or replace `CreativeAgentGateway` in `lib/contracts/agent.ts`.

The current adapter is `lib/agents/creative-agent-gateway.ts`, which delegates to `runInitialGraphPipeline`, `runGrowthPipeline`, `runRelationPipeline` and `runStoryConvergePipeline`. B can refactor prompts or model services behind that gateway without changing routes.

## C Workflow & Backend

Own `ProjectRepository` in `lib/repositories/project-repository.ts`, route handlers, graph commit semantics and future database/LangGraph integration.

`MemoryProjectRepository` is not production persistence. C1 should add `PostgresProjectRepository` behind the same interface.

## D Product & Quality

Depend on `docs/API_CONTRACT.md`, `lib/contracts/` and `tests/fixtures/`.

The frontend may keep localStorage during C0, but new product work should treat `/api/projects/:projectId/graph` and `/api/graph/commit` as the server integration path.
