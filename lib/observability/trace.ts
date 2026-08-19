import postgres from "postgres";

import type { AgentRunContext, AgentTrace, AgentTraceSink } from "../contracts";
import { getRuntimeEnv } from "../runtime/env";

export type TraceQuery = { requestId?: string; threadId?: string; projectId?: string; limit?: number };

interface QueryableTraceSink extends AgentTraceSink {
  list(query: TraceQuery): Promise<AgentTrace[]>;
}

class MemoryTraceSink implements QueryableTraceSink {
  private readonly traces: AgentTrace[] = [];

  async record(trace: AgentTrace) {
    this.traces.push(structuredClone(trace));
    if (this.traces.length > 1_000) this.traces.splice(0, this.traces.length - 1_000);
  }

  async list(query: TraceQuery) {
    return this.traces
      .filter((trace) => !query.requestId || trace.requestId === query.requestId)
      .filter((trace) => !query.threadId || trace.threadId === query.threadId)
      .filter((trace) => !query.projectId || trace.projectId === query.projectId)
      .slice(-(query.limit ?? 100))
      .reverse()
      .map((trace) => structuredClone(trace));
  }
}

class PostgresTraceSink implements QueryableTraceSink {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 3, connect_timeout: 10, idle_timeout: 20, onnotice: () => undefined });
  }

  async record(trace: AgentTrace) {
    await this.sql`
      INSERT INTO agent_traces (
        id, request_id, thread_id, project_id, agent, workflow_node, model,
        prompt_version, schema_version, started_at, ended_at, latency_ms,
        input_tokens, output_tokens, success, error_code, retry_count, retrieval_hit_count
      ) VALUES (
        ${trace.id}, ${trace.requestId ?? null}, ${trace.threadId ?? null}, ${trace.projectId ?? null},
        ${trace.agent}, ${trace.workflowNode ?? null}, ${trace.model ?? null}, ${trace.promptVersion ?? null},
        ${trace.schemaVersion ?? null}, ${trace.startedAt}, ${trace.endedAt ?? null}, ${trace.latencyMs ?? null},
        ${trace.inputTokens ?? null}, ${trace.outputTokens ?? null}, ${trace.success}, ${trace.errorCode ?? null},
        ${trace.retryCount ?? 0}, ${trace.retrievalHitCount ?? null}
      )
    `;
  }

  async list(query: TraceQuery) {
    const limit = Math.max(1, Math.min(query.limit ?? 100, 500));
    const rows = await this.sql<Record<string, unknown>[]>`
      SELECT * FROM agent_traces
      WHERE (${query.requestId ?? null}::text IS NULL OR request_id = ${query.requestId ?? null})
        AND (${query.threadId ?? null}::text IS NULL OR thread_id = ${query.threadId ?? null})
        AND (${query.projectId ?? null}::text IS NULL OR project_id = ${query.projectId ?? null})
      ORDER BY started_at DESC LIMIT ${limit}
    `;
    return rows.map((row) => ({
      id: String(row.id),
      requestId: row.request_id ? String(row.request_id) : undefined,
      threadId: row.thread_id ? String(row.thread_id) : undefined,
      projectId: row.project_id ? String(row.project_id) : undefined,
      agent: String(row.agent),
      workflowNode: row.workflow_node ? String(row.workflow_node) : undefined,
      model: row.model ? String(row.model) : undefined,
      promptVersion: row.prompt_version ? String(row.prompt_version) : undefined,
      schemaVersion: row.schema_version ? String(row.schema_version) : undefined,
      startedAt: new Date(String(row.started_at)).toISOString(),
      endedAt: row.ended_at ? new Date(String(row.ended_at)).toISOString() : undefined,
      latencyMs: row.latency_ms === null ? undefined : Number(row.latency_ms),
      inputTokens: row.input_tokens === null ? undefined : Number(row.input_tokens),
      outputTokens: row.output_tokens === null ? undefined : Number(row.output_tokens),
      success: Boolean(row.success),
      errorCode: row.error_code ? String(row.error_code) : undefined,
      retryCount: Number(row.retry_count ?? 0),
      retrievalHitCount: row.retrieval_hit_count === null ? undefined : Number(row.retrieval_hit_count),
    }));
  }
}

const memorySink = new MemoryTraceSink();
const postgresSinks = new Map<string, PostgresTraceSink>();

async function getTraceSink(): Promise<QueryableTraceSink> {
  const env = await getRuntimeEnv();
  if (String(env.PERSISTENCE_PROVIDER ?? "memory").toLowerCase() !== "postgres" || !env.DATABASE_URL) return memorySink;
  let sink = postgresSinks.get(env.DATABASE_URL);
  if (!sink) {
    sink = new PostgresTraceSink(env.DATABASE_URL);
    postgresSinks.set(env.DATABASE_URL, sink);
  }
  return sink;
}

export async function traceCall<T>(
  agent: string,
  workflowNode: string,
  context: AgentRunContext | undefined,
  operation: () => Promise<T>,
  metadata: Partial<Pick<AgentTrace, "retrievalHitCount" | "retryCount">> = {},
): Promise<T> {
  const started = Date.now();
  const env = await getRuntimeEnv();
  let success = false;
  let errorCode: string | undefined;
  try {
    const result = await operation();
    success = true;
    return result;
  } catch (error) {
    errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.name : "UNKNOWN";
    throw error;
  } finally {
    const ended = Date.now();
    const trace: AgentTrace = {
      id: `trace_${crypto.randomUUID()}`,
      requestId: context?.requestId,
      threadId: context?.threadId,
      projectId: context?.projectId,
      agent,
      workflowNode,
      model: env.OPENAI_MODEL ?? env.DEEPSEEK_MODEL ?? (env.CREATIVE_MODEL_PROVIDER === "mock" ? "mock" : undefined),
      promptVersion: "creative-graph-v1",
      schemaVersion: "c0",
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      latencyMs: ended - started,
      success,
      errorCode,
      retryCount: 0,
      ...metadata,
    };
    try { await (await getTraceSink()).record(trace); } catch { /* observability must not fail business work */ }
  }
}

export async function recordTrace(trace: AgentTrace) {
  try { await (await getTraceSink()).record(trace); } catch { /* best effort */ }
}

export async function listTraces(query: TraceQuery) {
  return (await getTraceSink()).list(query);
}
