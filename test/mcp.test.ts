import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpAction } from "../src/backend/mcp";
import { transactionTrace } from "../src/backend/repository";
import { verifyHistoricalAction } from "../src/backend/service";

const historicalAction = {
  title: "Add connection leak detector and capacity guard",
  rationale: "Restarting did not remove the connection leak.",
  risk: "low" as const,
  owner: "Platform",
};

test("MCP parser accepts the real text response shape", () => {
  const action = parseMcpAction([{
    type: "text",
    text: JSON.stringify({ rows: [{
      id: "11111111-1111-4111-8111-111111111111",
      ...historicalAction,
      status: "approved",
    }] }),
  }]);

  assert.deepEqual(action, { ...historicalAction, status: "approved" });
});

test("MCP parser returns no action for empty rows and rejects malformed payloads", () => {
  assert.equal(parseMcpAction([{ type: "text", text: '{"rows":[]}' }]), undefined);
  assert.throws(() => parseMcpAction([{ type: "text", text: "not-json" }]));
});

test("MCP success is authoritative and does not call direct-read fallback", async () => {
  let fallbackCalls = 0;
  const result = await verifyHistoricalAction(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    async () => ({ action: { ...historicalAction, status: "approved" as const }, detail: "verified" }),
    async () => { fallbackCalls += 1; return undefined; },
  );

  assert.equal(result.action?.title, historicalAction.title);
  assert.equal(result.degraded, false);
  assert.equal(fallbackCalls, 0);
});

test("malformed MCP failure uses direct read and marks verification degraded", async () => {
  const result = await verifyHistoricalAction(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    async () => { throw new Error("invalid MCP payload"); },
    async () => ({
      id: "33333333-3333-4333-8333-333333333333",
      incidentId: "22222222-2222-4222-8222-222222222222",
      createdAt: new Date().toISOString(),
      status: "approved" as const,
      ...historicalAction,
    }),
  );

  assert.equal(result.degraded, true);
  assert.equal(result.action?.title, historicalAction.title);
  assert.match(result.detail, /fixed direct read used/i);
});

test("transaction trace records a positive measured latency", () => {
  const trace = transactionTrace(1, Date.now() - 5);
  assert.ok(trace.latencyMs >= 1);
  assert.match(trace.detail, /1 pending action/);
});
