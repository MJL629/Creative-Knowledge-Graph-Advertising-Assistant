import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../lib/contracts";
import { MemoryProjectRepository } from "../lib/repositories/memory-project-repository";

const brief = { product: "Test product", ideaFragments: ["A surprising opening"] };

test("memory repository preserves revision and rollback semantics", async () => {
  const repository = new MemoryProjectRepository();
  const project = await repository.createProject({ name: "Memory test", brief });
  const first = await repository.commitGraph({
    projectId: project.id,
    expectedRevision: 0,
    operations: [
      { type: "ADD_NODE", node: { id: "n1", label: "First" } },
      { type: "ADD_NODE", node: { id: "n2", label: "Second" } },
      { type: "ADD_EDGE", edge: { id: "e1", sourceId: "n1", targetId: "n2", label: "supports" } },
    ],
  });
  assert.equal(first.revision, 1);
  assert.equal(first.nodes.length, 2);
  assert.equal(first.edges.length, 1);

  await assert.rejects(
    repository.commitGraph({ projectId: project.id, expectedRevision: 0, operations: [] }),
    (error: unknown) => error instanceof AppError && error.status === 409,
  );
  await assert.rejects(
    repository.commitGraph({
      projectId: project.id,
      expectedRevision: 1,
      operations: [
        { type: "ADD_NODE", node: { id: "rolled-back", label: "Temporary" } },
        { type: "ADD_EDGE", edge: { sourceId: "n1", targetId: "missing", label: "invalid" } },
      ],
    }),
    (error: unknown) => error instanceof AppError && error.status === 400,
  );
  const afterRollback = await repository.getGraph(project.id);
  assert.equal(afterRollback?.revision, 1);
  assert.equal(afterRollback?.nodes.some((node) => node.id === "rolled-back"), false);

  const operationId = `memory-${crypto.randomUUID()}`;
  const idempotent = await repository.commitGraph({
    projectId: project.id,
    expectedRevision: 1,
    operationId,
    operations: [{ type: "UPDATE_NODE", nodeId: "n1", patch: { importance: 5 } }],
  });
  const replay = await repository.commitGraph({
    projectId: project.id,
    expectedRevision: 1,
    operationId,
    operations: [{ type: "UPDATE_NODE", nodeId: "n1", patch: { importance: 5 } }],
  });
  assert.deepEqual(replay, idempotent);

  const hierarchy = await repository.commitGraph({
    projectId: project.id,
    expectedRevision: idempotent.revision,
    operations: [
      { type: "ADD_NODE", node: { id: "parent", label: "Parent" } },
      { type: "ADD_NODE", node: { id: "child", label: "Child", parentId: "parent", depth: 2 } },
      { type: "ADD_NODE", node: { id: "grandchild", label: "Grandchild", parentId: "child", depth: 3 } },
    ],
  });
  const currentOnly = await repository.commitGraph({
    projectId: project.id,
    expectedRevision: hierarchy.revision,
    operations: [{ type: "DELETE_NODE", nodeId: "child", cascade: false }],
  });
  assert.equal(currentOnly.nodes.find((node) => node.id === "grandchild")?.parentId, "parent");
  const cascade = await repository.commitGraph({
    projectId: project.id,
    expectedRevision: currentOnly.revision,
    operations: [{ type: "DELETE_NODE", nodeId: "parent", cascade: true }],
  });
  assert.equal(cascade.nodes.some((node) => ["parent", "grandchild"].includes(node.id)), false);
});
