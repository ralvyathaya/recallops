import assert from "node:assert/strict";
import test from "node:test";
import { assessmentSchema, groundAssessment } from "../src/backend/bedrock";
import type { HistoricalAction } from "../src/backend/bedrock";
import type { Memory } from "../src/lib/types";

const memory: Memory = {
  id: "11111111-1111-4111-8111-111111111111",
  incidentId: "22222222-2222-4222-8222-222222222222",
  kind: "diagnosis",
  service: "checkout-api",
  title: "Verified pool exhaustion",
  content: "Pool saturation was caused by leaked sessions.",
  status: "verified",
  confidence: 0.94,
  score: 0.88,
  matchLabel: "strong",
  createdAt: new Date().toISOString(),
};

const historicalAction: HistoricalAction = {
  title: "Add connection leak detector and capacity guard",
  rationale: "Restarting did not remove the leak.",
  risk: "low",
  owner: "Platform",
};

const proposal = {
  summary: "Verified history shows this recurring connection-pool incident needs the unfinished permanent fix.",
  matchStrength: "strong" as const,
  citations: [memory.id],
  actions: [{
    title: "Model variation",
    rationale: "Use the cited evidence to close the permanent remediation gap.",
    risk: "high" as const,
    owner: "Model",
  }],
};

test("assessment schema rejects more than one action", () => {
  assert.throws(() => assessmentSchema.parse({ ...proposal, actions: [proposal.actions[0], proposal.actions[0]] }));
});

test("trusted memory canonicalizes one historical action", () => {
  const result = groundAssessment(proposal, [memory], historicalAction);
  assert.deepEqual(result.actions[0], {
    ...proposal.actions[0],
    title: historicalAction.title,
    risk: historicalAction.risk,
    owner: historicalAction.owner,
  });
});

test("untrusted memory cannot create an action", () => {
  const result = groundAssessment(proposal, [{ ...memory, status: "proposed" }], historicalAction);
  assert.equal(result.actions.length, 0);
});

test("invalid Bedrock output throws before persistence", () => {
  assert.throws(() => groundAssessment({ summary: "too short" }, [memory], historicalAction));
});
