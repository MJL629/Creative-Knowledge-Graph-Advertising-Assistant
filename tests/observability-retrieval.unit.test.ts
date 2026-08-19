import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../lib/contracts";
import { traceCall, listTraces } from "../lib/observability/trace";
import { HttpRetrievalProvider } from "../lib/retrieval/http-retrieval-provider";

test("HTTP retrieval adapter validates the stable RetrievalResult contract", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    query: "summer campaign",
    hits: [{ id: "hit-1", content: "Reference", score: 0.95, source: { name: "fixture" } }],
  });
  try {
    const provider = new HttpRetrievalProvider({ endpoint: "https://retrieval.invalid/query" });
    const result = await provider.retrieve({ query: "summer campaign" });
    assert.equal(result.hits[0].id, "hit-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HTTP retrieval adapter rejects invalid provider output", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ hits: [{ content: "missing fields" }] });
  try {
    const provider = new HttpRetrievalProvider({ endpoint: "https://retrieval.invalid/query" });
    await assert.rejects(provider.retrieve({ query: "test" }), (error: unknown) =>
      error instanceof AppError && error.code === "RETRIEVAL_INVALID_RESPONSE");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trace calls are queryable by request and preserve failure metadata", async () => {
  const requestId = `request-${crypto.randomUUID()}`;
  await assert.rejects(traceCall("creative", "creative_growth", { requestId, projectId: "fixture" }, async () => {
    throw new AppError("TEST_FAILURE", "expected", 502);
  }));
  const traces = await listTraces({ requestId });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].success, false);
  assert.equal(traces[0].workflowNode, "creative_growth");
  assert.equal(traces[0].errorCode, "TEST_FAILURE");
});
