import postgres from "postgres";

import {
  AppError,
  ERROR_CODES,
  type CreativeBrief,
  type GraphCommitRequest,
  type GraphEdge,
  type GraphNode,
  type GraphSnapshot,
  type Project,
  type ProjectSummary,
  type StoryVersion,
} from "../contracts";
import { applyGraphOperations } from "./graph-operations";
import type { ProjectRepository } from "./project-repository";

type Queryable = postgres.Sql | postgres.TransactionSql;
type Row = Record<string, unknown>;

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function toJsonValue(value: unknown): postgres.JSONValue {
  try {
    return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Value must be JSON serializable", 400);
  }
}

function toProject(row: Row): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    brief: row.brief as CreativeBrief,
    graphRevision: Number(row.graph_revision),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toNode(row: Row): GraphNode {
  const type = String(row.type);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    type,
    category: row.category ? String(row.category) : type,
    subtype: row.subtype ? String(row.subtype) : undefined,
    label: String(row.label),
    title: row.title ? String(row.title) : String(row.label),
    description: row.description ? String(row.description) : undefined,
    status: row.status as GraphNode["status"],
    parentId: row.parent_id ? String(row.parent_id) : null,
    depth: Number(row.depth),
    originalParentId: row.original_parent_id ? String(row.original_parent_id) : null,
    originalDepth: row.original_depth === null || row.original_depth === undefined ? undefined : Number(row.original_depth),
    importance: row.importance === null || row.importance === undefined ? undefined : Number(row.importance),
    position: row.position as GraphNode["position"],
    attributes: row.attributes as GraphNode["attributes"],
    sourceRefs: row.source_refs as string[] | undefined,
    provenance: row.provenance ? String(row.provenance) : undefined,
    growthMode: row.growth_mode ? String(row.growth_mode) : undefined,
    actorRefs: row.actor_refs as string[] | undefined,
    productFeatureRefs: row.product_feature_refs as string[] | undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toEdge(row: Row): GraphEdge {
  const sourceId = String(row.source_id);
  const targetId = String(row.target_id);
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    sourceId,
    targetId,
    source: sourceId,
    target: targetId,
    type: row.type ? String(row.type) : undefined,
    label: String(row.label),
    status: row.status as GraphEdge["status"],
    direction: row.direction as GraphEdge["direction"],
    sourceRefs: row.source_refs as string[] | undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function readGraph(sql: Queryable, projectId: string, knownRevision?: number): Promise<GraphSnapshot | null> {
  const projects = knownRevision === undefined
    ? await sql<Row[]>`SELECT graph_revision FROM projects WHERE id = ${projectId}`
    : [{ graph_revision: knownRevision }];
  if (!projects.length) return null;
  const [nodes, edges] = await Promise.all([
    sql<Row[]>`SELECT * FROM graph_nodes WHERE project_id = ${projectId} ORDER BY created_at, id`,
    sql<Row[]>`SELECT * FROM graph_edges WHERE project_id = ${projectId} ORDER BY created_at, id`,
  ]);
  return {
    projectId,
    revision: Number(projects[0].graph_revision),
    nodes: nodes.map(toNode),
    edges: edges.map(toEdge),
  };
}

async function replaceGraph(sql: postgres.TransactionSql, snapshot: GraphSnapshot) {
  await sql`DELETE FROM graph_edges WHERE project_id = ${snapshot.projectId}`;
  await sql`DELETE FROM graph_nodes WHERE project_id = ${snapshot.projectId}`;

  for (const node of snapshot.nodes) {
    await sql`
      INSERT INTO graph_nodes (
        id, project_id, type, subtype, category, label, title, description, status,
        parent_id, depth, original_parent_id, original_depth, importance, position,
        attributes, source_refs, provenance, growth_mode, actor_refs, product_feature_refs,
        created_at, updated_at
      ) VALUES (
        ${node.id}, ${node.projectId}, ${node.type}, ${node.subtype ?? null}, ${node.category ?? null},
        ${node.label}, ${node.title ?? null}, ${node.description ?? null}, ${node.status},
        ${node.parentId ?? null}, ${node.depth}, ${node.originalParentId ?? null}, ${node.originalDepth ?? null},
        ${node.importance ?? null}, ${sql.json(node.position ?? null)}, ${sql.json(node.attributes ?? null)},
        ${sql.json(node.sourceRefs ?? null)}, ${node.provenance ?? null}, ${node.growthMode ?? null},
        ${sql.json(node.actorRefs ?? null)}, ${sql.json(node.productFeatureRefs ?? null)},
        ${node.createdAt}, ${node.updatedAt}
      )
    `;
  }

  for (const edge of snapshot.edges) {
    await sql`
      INSERT INTO graph_edges (
        id, project_id, source_id, target_id, type, label, direction, status,
        source_refs, created_at, updated_at
      ) VALUES (
        ${edge.id}, ${edge.projectId}, ${edge.sourceId}, ${edge.targetId}, ${edge.type ?? null},
        ${edge.label}, ${edge.direction ?? null}, ${edge.status}, ${sql.json(edge.sourceRefs ?? null)},
        ${edge.createdAt}, ${edge.updatedAt}
      )
    `;
  }
}

export class PostgresProjectRepository implements ProjectRepository {
  private readonly sql: postgres.Sql;

  constructor(databaseUrl: string, options: { max?: number } = {}) {
    if (!databaseUrl.trim()) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, "DATABASE_URL is required for postgres persistence", 503);
    }
    this.sql = postgres(databaseUrl, {
      max: options.max ?? 10,
      connect_timeout: 10,
      idle_timeout: 20,
      onnotice: () => undefined,
    });
  }

  async close() {
    await this.sql.end({ timeout: 5 });
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AppError) throw error;
      const databaseCode = typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        "PostgreSQL persistence is unavailable",
        503,
        databaseCode ? { databaseCode } : undefined,
      );
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return this.run(async () => {
      const rows = await this.sql<Row[]>`
        SELECT id, name, graph_revision, created_at, updated_at
        FROM projects ORDER BY updated_at DESC
      `;
      return rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        graphRevision: Number(row.graph_revision),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      }));
    });
  }

  async createProject(input: { name: string; brief: CreativeBrief }): Promise<Project> {
    return this.run(async () => {
      const id = newId("project");
      const rows = await this.sql<Row[]>`
        INSERT INTO projects (id, name, brief)
        VALUES (${id}, ${input.name.trim()}, ${this.sql.json(toJsonValue(input.brief))})
        RETURNING *
      `;
      return toProject(rows[0]);
    });
  }

  async getProject(projectId: string): Promise<Project | null> {
    return this.run(async () => {
      const rows = await this.sql<Row[]>`SELECT * FROM projects WHERE id = ${projectId}`;
      return rows.length ? toProject(rows[0]) : null;
    });
  }

  async updateProject(projectId: string, patch: { name?: string; brief?: CreativeBrief }): Promise<Project | null> {
    return this.run(async () => {
      const rows = await this.sql<Row[]>`
        UPDATE projects
        SET name = COALESCE(${patch.name ?? null}, name),
            brief = COALESCE(${patch.brief ? this.sql.json(toJsonValue(patch.brief)) : null}, brief),
            updated_at = NOW()
        WHERE id = ${projectId}
        RETURNING *
      `;
      return rows.length ? toProject(rows[0]) : null;
    });
  }

  async deleteProject(projectId: string): Promise<boolean> {
    return this.run(async () => {
      const rows = await this.sql<Row[]>`DELETE FROM projects WHERE id = ${projectId} RETURNING id`;
      return rows.length > 0;
    });
  }

  async getGraph(projectId: string): Promise<GraphSnapshot | null> {
    return this.run(() => readGraph(this.sql, projectId));
  }

  async commitGraph(input: GraphCommitRequest): Promise<GraphSnapshot> {
    return this.run(() => this.sql.begin(async (tx) => {
      const projects = await tx<Row[]>`
        SELECT id, graph_revision FROM projects WHERE id = ${input.projectId} FOR UPDATE
      `;
      if (!projects.length) throw new AppError(ERROR_CODES.PROJECT_NOT_FOUND, "Project not found", 404);
      const actualRevision = Number(projects[0].graph_revision);
      const current = await readGraph(tx, input.projectId, actualRevision);
      if (!current) throw new AppError(ERROR_CODES.GRAPH_NOT_FOUND, "Graph not found", 404);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== actualRevision) {
        throw new AppError(ERROR_CODES.GRAPH_REVISION_CONFLICT, "Graph revision conflict", 409, {
          expectedRevision: input.expectedRevision,
          actualRevision,
          snapshot: current,
        });
      }

      const updatedAt = new Date().toISOString();
      const next = applyGraphOperations(current, input.operations, updatedAt);
      next.revision = actualRevision + 1;
      await replaceGraph(tx, next);
      await tx`
        UPDATE projects
        SET graph_revision = ${next.revision}, updated_at = ${updatedAt}
        WHERE id = ${input.projectId}
      `;
      const persisted = await readGraph(tx, input.projectId, next.revision);
      if (!persisted) throw new AppError(ERROR_CODES.GRAPH_NOT_FOUND, "Graph not found after commit", 500);
      return persisted;
    }));
  }

  async listStoryVersions(projectId: string): Promise<StoryVersion[] | null> {
    return this.run(async () => {
      const projects = await this.sql<Row[]>`SELECT id FROM projects WHERE id = ${projectId}`;
      if (!projects.length) return null;
      const rows = await this.sql<Row[]>`
        SELECT * FROM story_versions WHERE project_id = ${projectId} ORDER BY version
      `;
      return rows.map((row) => ({
        id: String(row.id),
        projectId: String(row.project_id),
        version: Number(row.version),
        graphRevision: Number(row.graph_revision),
        content: row.content,
        createdAt: iso(row.created_at),
      }));
    });
  }

  async saveStoryVersion(input: { projectId: string; graphRevision: number; content: unknown }): Promise<StoryVersion | null> {
    return this.run(() => this.sql.begin(async (tx) => {
      const projects = await tx<Row[]>`
        SELECT id, graph_revision FROM projects WHERE id = ${input.projectId} FOR UPDATE
      `;
      if (!projects.length) return null;
      const actualRevision = Number(projects[0].graph_revision);
      if (input.graphRevision !== actualRevision) {
        const snapshot = await readGraph(tx, input.projectId, actualRevision);
        throw new AppError(ERROR_CODES.GRAPH_REVISION_CONFLICT, "Story graph revision conflict", 409, {
          expectedRevision: input.graphRevision,
          actualRevision,
          ...(snapshot ? { snapshot } : {}),
        });
      }
      const versions = await tx<Row[]>`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM story_versions WHERE project_id = ${input.projectId}
      `;
      const version = Number(versions[0].version);
      const rows = await tx<Row[]>`
        INSERT INTO story_versions (id, project_id, version, graph_revision, content)
        VALUES (${newId("story")}, ${input.projectId}, ${version}, ${input.graphRevision}, ${tx.json(toJsonValue(input.content))})
        RETURNING *
      `;
      await tx`UPDATE projects SET updated_at = NOW() WHERE id = ${input.projectId}`;
      const row = rows[0];
      return {
        id: String(row.id),
        projectId: String(row.project_id),
        version: Number(row.version),
        graphRevision: Number(row.graph_revision),
        content: row.content,
        createdAt: iso(row.created_at),
      };
    }));
  }
}
