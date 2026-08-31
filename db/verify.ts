import postgres from "postgres";

import { PostgresWorkflowCheckpointerProvider } from "../lib/workflow/checkpointer";

const databaseUrl = process.env.DATABASE_URL;
const workflowDatabaseUrl = process.env.WORKFLOW_DATABASE_URL ?? databaseUrl;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
if (!workflowDatabaseUrl) throw new Error("WORKFLOW_DATABASE_URL or DATABASE_URL is required");

const requiredTables = ["projects", "graph_nodes", "graph_edges", "story_versions", "graph_commit_idempotency", "agent_traces"];
const sql = postgres(databaseUrl, { max: 1, connect_timeout: 10 });

try {
  const rows = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${requiredTables})
  `;
  const present = new Set(rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !present.has(table));
  if (missing.length) throw new Error(`Missing migrated tables: ${missing.join(", ")}`);
  await sql`SELECT 1`;
} finally {
  await sql.end({ timeout: 5 });
}

const checkpointer = await PostgresWorkflowCheckpointerProvider.create(
  workflowDatabaseUrl,
  process.env.WORKFLOW_CHECKPOINT_SCHEMA ?? "langgraph",
);
await checkpointer.close();
console.log(`Database verification passed (${requiredTables.length} business tables + PostgreSQL workflow checkpointer).`);
