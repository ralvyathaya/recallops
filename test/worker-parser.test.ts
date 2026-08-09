import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { liveIncidentTemplate } from "../src/lib/scenario";
import { parseCloudWatchSignals } from "../src/backend/worker-handler";

function encode(logEvents: { id: string; timestamp: number; message: string }[], messageType = "DATA_MESSAGE") {
  return gzipSync(JSON.stringify({ messageType, logEvents })).toString("base64");
}

test("worker extracts only structured incident signals", () => {
  const signal = {
    event_type: "incident_signal",
    trace_id: "trace-1",
    workspace_id: crypto.randomUUID(),
    artifact_key: "evidence.json",
    incident: liveIncidentTemplate,
    started_at: new Date().toISOString(),
  } as const;
  const result = parseCloudWatchSignals(encode([
    { id: "1", timestamp: Date.now(), message: "START RequestId" },
    { id: "2", timestamp: Date.now(), message: JSON.stringify(signal) },
  ]));
  assert.equal(result.length, 1);
  assert.equal(result[0].incident.externalRef, "INC-2077");
});

test("worker ignores control and malformed messages", () => {
  assert.deepEqual(parseCloudWatchSignals(encode([], "CONTROL_MESSAGE")), []);
  assert.deepEqual(parseCloudWatchSignals(encode([{ id: "1", timestamp: 0, message: "not-json" }])), []);
});

test("worker accepts Lambda-prefixed application logs", () => {
  const signal = {
    event_type: "incident_signal",
    trace_id: "trace-prefixed",
    workspace_id: crypto.randomUUID(),
    incident: liveIncidentTemplate,
    started_at: new Date().toISOString(),
  } as const;
  const prefixed = `2026-08-09T12:00:00Z\trequest-id\tINFO\t${JSON.stringify(signal)}`;
  assert.equal(parseCloudWatchSignals(encode([{ id: "1", timestamp: Date.now(), message: prefixed }])).length, 1);
});
