CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brief JSONB NOT NULL,
  graph_revision INTEGER NOT NULL DEFAULT 0 CHECK (graph_revision >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  subtype TEXT,
  category TEXT,
  label TEXT NOT NULL,
  title TEXT,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('candidate', 'adopted', 'excluded', 'needs_review')),
  parent_id TEXT REFERENCES graph_nodes(id) ON DELETE SET NULL,
  depth INTEGER NOT NULL DEFAULT 1 CHECK (depth >= 0),
  original_parent_id TEXT,
  original_depth INTEGER,
  importance DOUBLE PRECISION,
  position JSONB,
  attributes JSONB,
  source_refs JSONB,
  provenance TEXT,
  growth_mode TEXT,
  actor_refs JSONB,
  product_feature_refs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, id)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type TEXT,
  label TEXT NOT NULL,
  direction TEXT CHECK (direction IS NULL OR direction IN ('forward', 'reverse', 'both')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'adopted', 'excluded', 'needs_review', 'pending')),
  source_refs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (source_id <> target_id),
  UNIQUE (project_id, id)
);

CREATE TABLE IF NOT EXISTS story_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS graph_nodes_project_id_idx ON graph_nodes(project_id);
CREATE INDEX IF NOT EXISTS graph_nodes_parent_id_idx ON graph_nodes(parent_id);
CREATE INDEX IF NOT EXISTS graph_edges_project_id_idx ON graph_edges(project_id);
CREATE INDEX IF NOT EXISTS graph_edges_source_id_idx ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS graph_edges_target_id_idx ON graph_edges(target_id);
CREATE INDEX IF NOT EXISTS story_versions_project_id_idx ON story_versions(project_id);
