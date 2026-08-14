import { bedrockModels, createAssessment, embedText, type HistoricalAction } from "./bedrock";
import { inspectIncidentViaMcp } from "./mcp";
import {
  assertRecallRate,
  cleanupExpiredWorkspaces,
  completeAction,
  decideAction,
  ensureWorkspace,
  getIncident,
  getOpenActionForIncident,
  getState,
  ingestIncident,
  resetWorkspace,
  resolveIncident,
  retrieveMemories,
  saveAssessment,
  verifyMemory,
} from "./repository";
import { getArtifact, putArtifact } from "./storage";
import { liveIncidentTemplate } from "@/lib/scenario";
import type { AgentAssessment, ToolTrace } from "@/lib/types";

export interface IncidentSignal {
  event_type: "incident_signal";
  trace_id: string;
  workspace_id: string;
  artifact_key?: string;
  incident: typeof liveIncidentTemplate;
  started_at: string;
}

const elapsed = (started: number) => Date.now() - started;

export async function verifyHistoricalAction(
  workspaceId: string,
  incidentId: string,
  inspect = inspectIncidentViaMcp,
  fallback = getOpenActionForIncident,
): Promise<{ action?: HistoricalAction; detail: string; degraded: boolean }> {
  try {
    const result = await inspect(workspaceId, incidentId);
    return { action: result.action, detail: result.detail, degraded: false };
  } catch (error) {
    return {
      action: await fallback(workspaceId, incidentId),
      detail: `Managed MCP unavailable; fixed direct read used (${error instanceof Error ? error.message : "unknown error"})`,
      degraded: true,
    };
  }
}

export async function startSession(workspaceId: string) {
  await ensureWorkspace(workspaceId);
  return getState(workspaceId);
}

export async function triggerDemo(workspaceId: string, traceId: string) {
  const startedAt = new Date().toISOString();
  const key = `workspaces/${workspaceId}/incidents/${liveIncidentTemplate.externalRef}-${Date.now()}.json`;
  let artifactKey: string | undefined;
  let degraded: AgentAssessment["degraded"] = [];
  try {
    artifactKey = await putArtifact(key, JSON.stringify({ ...liveIncidentTemplate, startedAt }, null, 2));
  } catch (error) {
    degraded = ["artifact"];
    console.warn(JSON.stringify({ traceId, stage: "artifact_write", error: error instanceof Error ? error.message : "unknown" }));
  }
  const signal: IncidentSignal = {
    event_type: "incident_signal",
    trace_id: traceId,
    workspace_id: workspaceId,
    artifact_key: artifactKey,
    incident: liveIncidentTemplate,
    started_at: startedAt,
  };
  console.log(JSON.stringify(signal));
  return { externalRef: liveIncidentTemplate.externalRef, accepted: true, degraded };
}

export async function ingestSignal(signal: IncidentSignal) {
  let payload = signal.incident;
  if (signal.artifact_key) {
    try {
      payload = JSON.parse(await getArtifact(signal.artifact_key)) as typeof liveIncidentTemplate;
    } catch (error) {
      console.warn(JSON.stringify({ traceId: signal.trace_id, stage: "artifact_read", error: error instanceof Error ? error.message : "unknown" }));
    }
  }
  const incident = await ingestIncident(signal.workspace_id, {
    externalRef: payload.externalRef,
    service: payload.service,
    title: payload.title,
    severity: payload.severity,
    summary: payload.summary,
    artifactKey: signal.artifact_key,
    startedAt: signal.started_at,
    embedding: await embedText(`${payload.title}\n${payload.summary}`),
  });
  console.log(JSON.stringify({ traceId: signal.trace_id, incidentId: incident.id, stage: "ingestion_complete" }));
  return incident;
}

export async function recallIncident(workspaceId: string, incidentId: string) {
  await assertRecallRate(workspaceId);
  const incident = await getIncident(workspaceId, incidentId);
  if (!incident) throw new Error("Incident not found");
  const overallStarted = Date.now();
  const trace: ToolTrace[] = [];
  const degraded: AgentAssessment["degraded"] = [];

  const vectorStarted = Date.now();
  const embedding = await embedText(`${incident.title}\n${incident.summary}`);
  const { matches, explain } = await retrieveMemories(workspaceId, incident, embedding);
  trace.push({
    name: "vector_search",
    status: "success",
    latencyMs: elapsed(vectorStarted),
    detail: `${matches.length} reranked matches · ${explain}`,
  });

  const sourceIncidentId = matches.find((memory) => memory.status === "verified" && (memory.score ?? 0) >= 0.6)?.incidentId;
  let openAction: HistoricalAction | undefined;
  const mcpStarted = Date.now();
  if (sourceIncidentId) {
    const verification = await verifyHistoricalAction(workspaceId, sourceIncidentId);
    openAction = verification.action;
    if (verification.degraded) degraded.push("mcp");
    trace.push({
      name: "mcp.select_query",
      status: verification.degraded ? "degraded" : "success",
      latencyMs: elapsed(mcpStarted),
      detail: verification.detail,
    });
  } else {
    trace.push({ name: "mcp.select_query", status: "skipped", latencyMs: 0, detail: "No trusted source incident to verify" });
  }

  const modelStarted = Date.now();
  let assessment;
  try {
    assessment = await createAssessment(incident.summary, matches, openAction);
    trace.push({ name: "bedrock.converse", status: "success", latencyMs: elapsed(modelStarted), detail: `Structured assessment via ${bedrockModels.reasoningModel}` });
  } catch (error) {
    degraded.push("bedrock");
    assessment = {
      summary: "Historical memories were retrieved, but the reasoning model was unavailable. No action was created; retry recall before remediation.",
      matchStrength: "none" as const,
      citations: [] as string[],
      actions: [],
    };
    trace.push({ name: "bedrock.converse", status: "degraded", latencyMs: elapsed(modelStarted), detail: error instanceof Error ? error.message : "Bedrock unavailable" });
  }

  const saved = await saveAssessment(
    workspaceId,
    incidentId,
    assessment,
    matches,
    trace,
    degraded,
    elapsed(overallStarted),
    bedrockModels.reasoningModel,
  );
  return { assessment, matches, actionIds: saved.actionIds, trace: saved.persistedTrace, degraded };
}

export async function resolveWithPostmortem(workspaceId: string, incidentId: string) {
  const incident = await getIncident(workspaceId, incidentId);
  if (!incident) throw new Error("Incident not found");
  const markdown = [
    `# ${incident.externalRef}: ${incident.title}`,
    "",
    "## Summary",
    incident.summary,
    "",
    "## Learning loop",
    "RecallOps linked the recurring pool-exhaustion signature to verified history, surfaced the incomplete capacity guard, and kept execution behind human approval.",
    "",
    `Generated: ${new Date().toISOString()}`,
  ].join("\n");
  const key = `workspaces/${workspaceId}/postmortems/${incident.externalRef}.md`;
  let artifactKey: string | undefined;
  const degraded: AgentAssessment["degraded"] = [];
  try {
    artifactKey = await putArtifact(key, markdown, "text/markdown");
  } catch {
    degraded.push("artifact");
  }
  const embedding = await embedText(`${incident.title}\n${incident.summary}\n${markdown}`);
  const result = await resolveIncident(workspaceId, incidentId, artifactKey, embedding);
  return { ...result, degraded };
}

export const service = {
  startSession,
  getState,
  triggerDemo,
  recallIncident,
  decideAction,
  completeAction,
  resolveWithPostmortem,
  verifyMemory,
  resetWorkspace,
  cleanupExpiredWorkspaces,
};
