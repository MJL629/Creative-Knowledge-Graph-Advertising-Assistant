import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import postgres from "postgres";

import type { CreativeAgentGateway, RetrievalProvider } from "../lib/contracts";
import { PostgresProjectRepository } from "../lib/repositories/postgres-project-repository";
import { PostgresWorkflowCheckpointerProvider } from "../lib/workflow/checkpointer";
import { WorkflowRuntime } from "../lib/workflow/workflow-runtime";

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL;

class DurableGateway implements CreativeAgentGateway {
  divergenceCalls = 0;
  growthCalls = 0;
  relationCalls = 0;
  storyCalls = 0;
  async initialDivergence() {
    this.divergenceCalls += 1;
    return { candidates: [{ clientKey: "durable-candidate", title: "Durable candidate" }] };
  }
  async growNode() {
    this.growthCalls += 1;
    return { candidates: [{ clientKey: "child", title: "Child" }] };
  }
  async suggestRelations() {
    this.relationCalls += 1;
    return { relations: [{ label: "supports" }] };
  }
  async convergeStory() {
    this.storyCalls += 1;
    return { concept: "Durable story" };
  }
}

let retrievalCalls = 0;
const retrieval: RetrievalProvider = {
  async retrieve(input) {
    retrievalCalls += 1;
    return { query: input.query, hits: [{ id: "knowledge-1", content: "Useful context", score: 1 }] };
  },
};

test("durable full chain resumes after runtime recreation", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const migration = await readFile(new URL("../db/migrations/0001_core_persistence.sql", import.meta.url), "utf8");
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  await admin.begin((tx) => tx.unsafe(migration));
  const repository1 = new PostgresProjectRepository(databaseUrl);
  const gateway = new DurableGateway();
  const project = await repository1.createProject({
    name: "Durable workflow fixture",
    brief: { product: "Fixture", knownFacts: ["Known"], ideaFragments: ["Start"] },
  });
  const threadId = `durable-${crypto.randomUUID()}`;
  const checkpointer1 = await PostgresWorkflowCheckpointerProvider.create(databaseUrl, "langgraph_test");
  try {
    const runtime1 = new WorkflowRuntime({ repository: repository1, retrievalProvider: retrieval, agentGateway: gateway, checkpointerProvider: checkpointer1 });
    const paused = await runtime1.start({ projectId: project.id, threadId, needRag: true });
    assert.equal(paused.interrupts.length, 1);
    assert.equal(gateway.divergenceCalls, 1);
    assert.equal(retrievalCalls, 1);

    await repository1.close();
    await checkpointer1.close();

    const repository2 = new PostgresProjectRepository(databaseUrl);
    const checkpointer2 = await PostgresWorkflowCheckpointerProvider.create(databaseUrl, "langgraph_test");
    try {
      const runtime2 = new WorkflowRuntime({ repository: repository2, retrievalProvider: retrieval, agentGateway: gateway, checkpointerProvider: checkpointer2 });
      const restored = await runtime2.getState(threadId);
      assert.equal(restored.interrupts.length, 1);
      const growthPaused = await runtime2.resume(threadId, {
        action: "grow",
        operations: [
          { type: "ADD_NODE", node: { id: "root-node", label: "Root node" } },
          { type: "ADOPT_NODE", nodeId: "root-node" },
        ],
        focusNodeId: "root-node",
      });
      assert.equal(growthPaused.interrupts.length, 1);
      assert.equal(gateway.growthCalls, 1);

      const relationPaused = await runtime2.resume(threadId, {
        action: "relations",
        operations: [
          { type: "ADD_NODE", node: { id: "child-node", label: "Child node", parentId: "root-node", depth: 2 } },
          { type: "ADOPT_NODE", nodeId: "child-node" },
        ],
        sourceNodeId: "root-node",
        targetNodeId: "child-node",
      });
      assert.equal(relationPaused.interrupts.length, 1);
      assert.equal(gateway.relationCalls, 1);

      const completed = await runtime2.resume(threadId, {
        action: "concept",
        operations: [
          { type: "ADD_EDGE", edge: { id: "adopted-edge", sourceId: "root-node", targetId: "child-node", label: "supports" } },
          { type: "ADOPT_EDGE", edgeId: "adopted-edge" },
        ],
      });
      assert.deepEqual(completed.next, []);
      assert.equal(gateway.storyCalls, 1);
      assert.equal((await repository2.getGraph(project.id))?.revision, 3);
      assert.equal(gateway.divergenceCalls, 1);
      const story = await repository2.saveStoryVersion({ projectId: project.id, graphRevision: 3, content: completed.candidateResult });
      assert.equal(story?.version, 1);

      await checkpointer2.close();
      const checkpointer3 = await PostgresWorkflowCheckpointerProvider.create(databaseUrl, "langgraph_test");
      const repository3 = new PostgresProjectRepository(databaseUrl);
      try {
        const runtime3 = new WorkflowRuntime({ repository: repository3, retrievalProvider: retrieval, agentGateway: gateway, checkpointerProvider: checkpointer3 });
        assert.deepEqual((await runtime3.getState(threadId)).next, []);
        assert.equal((await repository3.getGraph(project.id))?.revision, 3);
        assert.equal((await repository3.listStoryVersions(project.id))?.length, 1);
        await repository3.deleteProject(project.id);
      } finally {
        await repository3.close();
        await checkpointer3.close();
      }
    } finally {
      await repository2.close();
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
});
