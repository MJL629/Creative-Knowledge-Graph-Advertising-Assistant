# PostgreSQL persistence

PostgreSQL is the durable source of truth for projects, Creative Graph nodes and edges, graph revisions, and story versions. The memory repository remains available only for offline demos and unit tests.

## Configuration

- `PERSISTENCE_PROVIDER=memory|postgres` selects the repository implementation.
- `DATABASE_URL` is required when the provider is `postgres`. Connection failures are explicit; the application never silently falls back to memory.
- `POSTGRES_TEST_DATABASE_URL` is the only database used by destructive integration fixtures. Never point it at production.

## Local database

```bash
docker compose -f docker-compose.dev.yml up -d postgres
```

The compose file exposes a test database on `localhost:54329`. Copy the sample URL from `.env.example` into a local, uncommitted environment.

## Migration

Schema changes live in `db/migrations` and never run implicitly at application startup.

```bash
DATABASE_URL=postgres://... npm run db:migrate
```

`0001_core_persistence.sql` is idempotent and creates the required primary keys, foreign keys, unique story-version guard, project indexes, and `ON DELETE CASCADE` relationships.

## Verification

```bash
POSTGRES_TEST_DATABASE_URL=postgres://... npm run test:postgres
```

The integration suite verifies CRUD, graph operations, revision conflicts, transaction rollback, unique story versions, project cascade deletion, and recovery after rebuilding the repository instance. Without `POSTGRES_TEST_DATABASE_URL`, the suite reports `SKIP`; it must not be reported as passing.
