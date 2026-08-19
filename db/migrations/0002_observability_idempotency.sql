CREATE TABLE IF NOT EXISTS graph_commit_idempotency (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, operation_id)
);

CREATE TABLE IF NOT EXISTS agent_traces (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  thread_id TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  agent TEXT NOT NULL,
  workflow_node TEXT,
  model TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  success BOOLEAN NOT NULL,
  error_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  retrieval_hit_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS graph_commit_idempotency_created_at_idx ON graph_commit_idempotency(created_at);
CREATE INDEX IF NOT EXISTS agent_traces_request_id_idx ON agent_traces(request_id);
CREATE INDEX IF NOT EXISTS agent_traces_thread_id_idx ON agent_traces(thread_id);
CREATE INDEX IF NOT EXISTS agent_traces_project_id_idx ON agent_traces(project_id);
