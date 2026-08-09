import assert from "node:assert/strict";
import test from "node:test";
import { rerankMemories } from "../src/lib/ranking";
import type { Memory } from "../src/lib/types";

const now = new Date("2026-08-09T12:00:00Z").getTime();

function memory(overrides: Partial<Memory & { similarity: number }> = {}): Memory & { similarity: number } {
  return {
    id: crypto.randomUUID(),
    kind: "diagnosis",
    service: "checkout-api",
    title: "Connection pool signature",
    content: "Pool at maximum with acquire timeouts",
    status: "verified",
    confidence: 0.9,
    similarity: 0.9,
    createdAt: "2026-07-09T12:00:00Z",
    ...overrides,
  };
}

test("hybrid reranking rewards service, trust, and recency", () => {
  const matches = rerankMemories([
    memory({ title: "trusted same service", similarity: 0.86 }),
    memory({ title: "semantic only", service: "inventory-api", status: "stale", similarity: 0.91 }),
  ], "checkout-api", now);
  assert.equal(matches[0].title, "trusted same service");
  assert.equal(matches[0].matchLabel, "strong");
});

test("threshold labels are enforced after weighted scoring", () => {
  const [possible] = rerankMemories([
    memory({ similarity: 0.65, status: "stale", createdAt: "2026-08-08T12:00:00Z" }),
  ], "checkout-api", now);
  assert.equal(possible.matchLabel, "possible");
  assert.ok(possible.score >= 0.6 && possible.score < 0.75);
});

test("retrieval returns at most five reranked candidates", () => {
  const matches = rerankMemories(Array.from({ length: 20 }, (_, index) => memory({ similarity: 0.99 - index / 100 })), "checkout-api", now);
  assert.equal(matches.length, 5);
  assert.ok(matches[0].score >= matches[4].score);
});
