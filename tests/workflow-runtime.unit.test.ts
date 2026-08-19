import assert from "node:assert/strict";
import test from "node:test";

import type { CreativeAgentGateway, RetrievalProvider } from "../lib/contracts";
import { AppError } from "../lib/contracts";
import { MemoryProjectRepository } from "../lib/repositories/memory-project-repository";
import { MemoryWorkflowCheckpointerProvider } from "../lib/workflow/checkpointer";
import { WorkflowRuntime } from "../lib/workflow/workflow-runtime";

class FakeGateway implements CreativeAgentGateway {
  divergenceCalls = 0;
  growthCalls = 0;
  relationCalls = 0;
  storyInputs: unknown[] = [];

  async initialDivergence() {
    this.divergenceCalls += 1;
    return { candidates: [{ clientKey: "candidate-1", title: "Candidate" }] };
  }
  async growNode() {
    this.growthCalls += 1;
    return { candidates: [{ clientKey: "child-1", title: "Child" }] };
  }
  async suggestRelations() {
    this.relationCalls += 1;
    return { relations: [{ label: "supports", direction: "forward" }] };
  }
  async convergeStory(input: unknown) {
    this.storyInputs.push(input);
    return { concept: "Adopted-only story" };
  }
}

const retrieval: RetrievalProvider = {
  async retrieve(input) { return { query: input.query, hits: [] }; },
};

async function fixture() {
  const repository = new MemoryProjectRepository();
  const gateway = new FakeGateway();
  const project = await repository.createProject({
    name: "Workflow fixture",
    brief: { product: "Fixture", knownFacts: ["Known"], ideaFragments: ["Start"] },
  });
  const runtime = new WorkflowRuntime({
    repository,
    retrievalProvider: retrieval,
    agentGateway: gateway,
    checkpointerProvider: new MemoryWorkflowCheckpointerProvider(),
  });
  return { repository, gateway, project, runtime };
}

test("start interrupts and resume commit does not auto-grow or regenerate", async () => {
  const { repository, gateway, project, runtime } = await fixture();
  const paused = await runtime.start({ projectId: project.id, threadId: "thread-start" });
  assert.equal(paused.interrupts.length, 1);
  assert.equal(paused.graphRevision, 0);
  assert.equal(gateway.divergenceCalls, 1);

  const completed = await runtime.resume("thread-start", {
    action: "commit",
    operations: [
      { type: "ADD_NODE", node: { id: "adopted", label: "Adopted" } },
      { type: "ADOPT_NODE", nodeId: "adopted" },
    ],
  });
  assert.deepEqual(completed.next, []);
  assert.equal((await repository.getGraph(project.id))?.revision, 1);
  assert.equal(gateway.divergenceCalls, 1);
  assert.equal(gateway.growthCalls, 0);
});

test("resume preserves optimistic revision conflict", async () => {
  const { repository, project, runtime } = await fixture();
  await runtime.start({ projectId: project.id, threadId: "thread-conflict" });
  await repository.commitGraph({
    projectId: project.id,
    expectedRevision: 0,
    operations: [{ type: "ADD_NODE", node: { id: "external", label: "External" } }],
  });
  await assert.rejects(
    runtime.resume("thread-conflict", { action: "commit", operations: [{ type: "ADD_NODE", node: { id: "late", label: "Late" } }] }),
    (error: unknown) => error instanceof AppError && error.status === 409,
  );
});

test("concept reloads and sends adopted subgraph only", async () => {
  const { repository, gateway, project, runtime } = await fixture();
  await repository.commitGraph({
    projectId: project.id,
    expectedRevision: 0,
    operations: [
      { type: "ADD_NODE", node: { id: "kept", label: "Kept" } },
      { type: "ADOPT_NODE", nodeId: "kept" },
      { type: "ADD_NODE", node: { id: "pending", label: "Pending" } },
    ],
  });
  const completed = await runtime.start({ projectId: project.id, threadId: "thread-story", intent: "concept" });
  assert.deepEqual(completed.next, []);
  const input = gateway.storyInputs[0] as { adoptedNodes: Array<{ id: string }> };
  assert.deepEqual(input.adoptedNodes.map((node) => node.id), ["kept"]);
});
