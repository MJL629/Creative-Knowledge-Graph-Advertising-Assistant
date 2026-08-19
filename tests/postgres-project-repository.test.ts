import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import postgres from "postgres";

import { AppError } from "../lib/contracts";
import { PostgresProjectRepository } from "../lib/repositories/postgres-project-repository";

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;

test("postgres repository real transaction, conflict, cascade, and recovery", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const migration = [
    await readFile(new URL("../db/migrations/0001_core_persistence.sql", import.meta.url), "utf8"),
    await readFile(new URL("../db/migrations/0002_observability_idempotency.sql", import.meta.url), "utf8"),
  ].join("\n");
  const admin = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
  await admin.begin((tx) => tx.unsafe(migration));
  const tables = await admin<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('projects', 'graph_nodes', 'graph_edges', 'story_versions')
  `;
  assert.equal(tables.length, 4);
  const cascadeForeignKeys = await admin<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM information_schema.referential_constraints
    WHERE constraint_schema = 'public' AND delete_rule = 'CASCADE'
  `;
  assert.ok(cascadeForeignKeys[0].count >= 5);
  const indexes = await admin<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'graph_nodes_project_id_idx', 'graph_nodes_parent_id_idx',
        'graph_edges_project_id_idx', 'graph_edges_source_id_idx',
        'graph_edges_target_id_idx', 'story_versions_project_id_idx'
      )
  `;
  assert.equal(indexes[0].count, 6);
  const repository = new PostgresProjectRepository(databaseUrl, { max: 5 });
  let projectId = "";
  try {
    const brief = { product: "Postgres fixture", ideaFragments: ["Start small"] };
    const project = await repository.createProject({ name: "Integration fixture", brief });
    projectId = project.id;
    assert.equal((await repository.getGraph(project.id))?.revision, 0);
    assert.ok((await repository.listProjects()).some((item) => item.id === project.id));
    assert.equal((await repository.updateProject(project.id, { name: "Updated fixture" }))?.name, "Updated fixture");

    const first = await repository.commitGraph({
      projectId: project.id,
      expectedRevision: 0,
      operations: [
        { type: "ADD_NODE", node: { id: "pg-n1", label: "First" } },
        { type: "ADD_NODE", node: { id: "pg-n2", label: "Second" } },
        { type: "ADD_EDGE", edge: { id: "pg-e1", sourceId: "pg-n1", targetId: "pg-n2", label: "supports" } },
        { type: "ADOPT_NODE", nodeId: "pg-n1" },
      ],
    });
    assert.equal(first.revision, 1);

    const concurrent = await Promise.allSettled([
      repository.commitGraph({ projectId: project.id, expectedRevision: 1, operations: [{ type: "UPDATE_NODE", nodeId: "pg-n1", patch: { label: "Winner A" } }] }),
      repository.commitGraph({ projectId: project.id, expectedRevision: 1, operations: [{ type: "UPDATE_NODE", nodeId: "pg-n1", patch: { label: "Winner B" } }] }),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    const conflict = concurrent.find((result) => result.status === "rejected");
    assert.ok(conflict && conflict.status === "rejected" && conflict.reason instanceof AppError && conflict.reason.status === 409);

    const beforeRollback = await repository.getGraph(project.id);
    assert.ok(beforeRollback);
    await assert.rejects(repository.commitGraph({
      projectId: project.id,
      expectedRevision: beforeRollback.revision,
      operations: [
        { type: "ADD_NODE", node: { id: "pg-rollback", label: "Rollback" } },
        { type: "ADD_EDGE", edge: { sourceId: "pg-n1", targetId: "missing", label: "invalid" } },
      ],
    }), (error: unknown) => error instanceof AppError && error.status === 400);
    assert.equal((await repository.getGraph(project.id))?.revision, beforeRollback.revision);

    const beforeIdempotency = await repository.getGraph(project.id);
    assert.ok(beforeIdempotency);
    const idempotentRequest = {
      projectId: project.id,
      expectedRevision: beforeIdempotency.revision,
      operationId: `idem-${crypto.randomUUID()}`,
      operations: [{ type: "UPDATE_NODE" as const, nodeId: "pg-n1", patch: { importance: 4 } }],
    };
    const idempotentFirst = await repository.commitGraph(idempotentRequest);
    const idempotentReplay = await repository.commitGraph(idempotentRequest);
    assert.equal(idempotentReplay.revision, idempotentFirst.revision);
    assert.equal(idempotentReplay.nodes.find((node) => node.id === "pg-n1")?.importance, 4);
    assert.equal((await repository.getGraph(project.id))?.revision, idempotentFirst.revision);
    await assert.rejects(repository.commitGraph({
      ...idempotentRequest,
      operations: [{ type: "UPDATE_NODE", nodeId: "pg-n1", patch: { importance: 5 } }],
    }), (error: unknown) => error instanceof AppError && error.status === 409);

    const hierarchy = await repository.commitGraph({
      projectId: project.id,
      expectedRevision: idempotentFirst.revision,
      operations: [
        { type: "ADD_NODE", node: { id: "tree-parent", label: "Parent" } },
        { type: "ADD_NODE", node: { id: "tree-child", label: "Child", parentId: "tree-parent", depth: 2 } },
        { type: "ADD_NODE", node: { id: "tree-grandchild", label: "Grandchild", parentId: "tree-child", depth: 3 } },
      ],
    });
    const currentOnly = await repository.commitGraph({
      projectId: project.id,
      expectedRevision: hierarchy.revision,
      operations: [{ type: "DELETE_NODE", nodeId: "tree-child", cascade: false }],
    });
    assert.equal(currentOnly.nodes.find((node) => node.id === "tree-grandchild")?.parentId, "tree-parent");
    assert.equal(currentOnly.nodes.find((node) => node.id === "tree-grandchild")?.originalParentId, "tree-child");
    const cascade = await repository.commitGraph({
      projectId: project.id,
      expectedRevision: currentOnly.revision,
      operations: [{ type: "DELETE_NODE", nodeId: "tree-parent", cascade: true }],
    });
    assert.equal(cascade.nodes.some((node) => node.id.startsWith("tree-")), false);

    const stories = await Promise.all(["One", "Two", "Three"].map((title) => repository.saveStoryVersion({
      projectId: project.id,
      graphRevision: cascade.revision,
      content: { title },
    })));
    assert.deepEqual(stories.map((story) => story?.version).sort(), [1, 2, 3]);

    const rebuilt = new PostgresProjectRepository(databaseUrl, { max: 2 });
    try {
      assert.equal((await rebuilt.getProject(project.id))?.name, "Updated fixture");
      assert.equal((await rebuilt.getGraph(project.id))?.revision, cascade.revision);
      assert.equal((await rebuilt.listStoryVersions(project.id))?.length, 3);
    } finally {
      await rebuilt.close();
    }

    assert.equal(await repository.deleteProject(project.id), true);
    projectId = "";
    const counts = await admin<{ count: number }[]>`
      SELECT ((SELECT COUNT(*) FROM graph_nodes WHERE project_id = ${project.id}) +
              (SELECT COUNT(*) FROM graph_edges WHERE project_id = ${project.id}) +
              (SELECT COUNT(*) FROM story_versions WHERE project_id = ${project.id}))::int AS count
    `;
    assert.equal(counts[0].count, 0);
  } finally {
    if (projectId) await repository.deleteProject(projectId).catch(() => false);
    await repository.close();
    await admin.end({ timeout: 5 });
  }
});
