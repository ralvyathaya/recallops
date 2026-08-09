import assert from "node:assert/strict";
import test from "node:test";
import { createScenario } from "../src/lib/scenario";

test("seed scenario contains a verified recurring memory and unfinished fix", () => {
  const state = createScenario();
  const memory = state.memories.find((item) => item.title.includes("Connection pool"));
  assert.equal(memory?.status, "verified");
  assert.ok(state.actions.some((action) => action.incidentId === memory?.incidentId && action.status === "approved"));
  assert.equal(state.incidents.length, 3);
});
