# Setup and deployment

## Local development

Requirements: Node.js 22.13+, npm, Git, and Docker for PostgreSQL integration tests.

```bash
npm ci
docker compose -f docker-compose.dev.yml up -d postgres
```

Copy `.env.example` to `.env`. The committed values are local-only samples; never commit real API keys or hosted database credentials.

```bash
npm run db:migrate
npm run dev
```

For a fully persistent local run, set `PERSISTENCE_PROVIDER=postgres`, `WORKFLOW_CHECKPOINTER=postgres`, and point `DATABASE_URL`/`WORKFLOW_DATABASE_URL` at the local container.

## Verification

```bash
npm run lint
npm test
npx tsc --noEmit
npm run test:postgres
npm run test:workflow:postgres
git diff --check
```

The PostgreSQL tests execute real migrations and verify transactions, revision conflicts, rollback, idempotency, both delete modes, story versions, cascade cleanup, checkpoint pause/resume, and restart recovery.

## Production

Production deliberately refuses memory persistence and memory checkpoints. Configure platform secrets for `PERSISTENCE_PROVIDER=postgres`, `DATABASE_URL`, `WORKFLOW_CHECKPOINTER=postgres`, `WORKFLOW_DATABASE_URL`, model provider credentials, and (when deployed) A-side retrieval endpoint credentials. Never expose these through `NEXT_PUBLIC_` or `VITE_` variables.

Run `npm run db:migrate` as a release step. `GET /api/health` returns provider states without URLs or keys. `GET /api/traces?requestId=...` (or `threadId`/`projectId`) locates best-effort execution traces without storing prompts or secrets.
