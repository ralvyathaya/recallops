"use client";

import { createScenario, liveIncidentTemplate } from "./scenario";
import type { ApiEnvelope, DashboardState, Memory, ToolTrace } from "./types";

const storageKey = "recallops-demo-v1";
export const isCloudMode = process.env.NEXT_PUBLIC_API_MODE === "cloud";
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function loadLocal() {
  const saved = localStorage.getItem(storageKey);
  if (saved) return JSON.parse(saved) as DashboardState;
  const state = createScenario();
  localStorage.setItem(storageKey, JSON.stringify(state));
  return state;
}

function saveLocal(state: DashboardState) {
  localStorage.setItem(storageKey, JSON.stringify(state));
  return structuredClone(state);
}

function localEvent(state: DashboardState, incidentId: string, source: "cloudwatch" | "agent" | "human" | "system", eventType: string, message: string) {
  state.events.push({ id: crypto.randomUUID(), incidentId, occurredAt: new Date().toISOString(), source, eventType, message });
}

async function request<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || envelope.error) throw new Error(envelope.error?.message ?? `Request failed (${response.status})`);
  return envelope;
}

async function localTrigger() {
  const state = loadLocal();
  const existing = state.incidents.find((incident) => incident.externalRef === liveIncidentTemplate.externalRef);
  if (existing) return state;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  state.incidents.unshift({
    id,
    externalRef: liveIncidentTemplate.externalRef,
    service: liveIncidentTemplate.service,
    title: liveIncidentTemplate.title,
    severity: liveIncidentTemplate.severity,
    status: "investigating",
    summary: liveIncidentTemplate.summary,
    artifactKey: `workspaces/${state.workspace.id}/incidents/INC-2077.json`,
    startedAt: now,
    isCurrent: true,
  });
  state.memories.unshift({
    id: crypto.randomUUID(),
    incidentId: id,
    kind: "diagnosis",
    service: liveIncidentTemplate.service,
    title: `Live signal: ${liveIncidentTemplate.title}`,
    content: liveIncidentTemplate.summary,
    status: "proposed",
    confidence: 0.55,
    createdAt: now,
  });
  localEvent(state, id, "cloudwatch", "incident_detected", "INC-2077 detected from CloudWatch signal");
  localEvent(state, id, "system", "artifact_ingested", "Synthetic log bundle stored in versioned S3 evidence storage");
  await wait(450);
  return saveLocal(state);
}

async function localRecall(incidentId: string) {
  const state = loadLocal();
  if (state.assessment?.incidentId === incidentId) return state;
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) throw new Error("Incident not found");
  const match = state.memories.find((memory) => memory.title === "Connection pool exhaustion signature");
  if (!match) throw new Error("Seed memory not found");
  match.similarity = 0.94;
  match.score = 0.923;
  match.matchLabel = "strong";
  const redHerring = state.memories.find((memory) => memory.title === "Checkout rollback runbook");
  if (redHerring) {
    redHerring.similarity = 0.66;
    redHerring.score = 0.617;
    redHerring.matchLabel = "possible";
  }
  const oldAction = state.actions.find((action) => action.incidentId === match.incidentId && action.status === "approved");
  const actionId = crypto.randomUUID();
  state.actions.unshift({
    id: actionId,
    incidentId,
    sourceMemoryId: match.id,
    title: oldAction?.title ?? "Validate connection-pool capacity guard",
    rationale: "The verified memory says restart was temporary, and MCP confirmed the permanent follow-up remains incomplete.",
    risk: "low",
    status: "pending_approval",
    owner: "Platform",
    createdAt: new Date().toISOString(),
  });
  const trace: ToolTrace[] = [
    { name: "vector_search", status: "success", latencyMs: 86, detail: "3 candidates · vector index scan memories_embedding_idx with workspace prefix" },
    { name: "mcp.select_query", status: "success", latencyMs: 112, detail: "Managed MCP confirmed historical action status = approved, completed_at = NULL" },
    { name: "bedrock.converse", status: "success", latencyMs: 681, detail: "Structured assessment via global.amazon.nova-2-lite-v1:0" },
    { name: "crdb.transaction", status: "success", latencyMs: 34, detail: "Atomic agent run + pending approval action" },
  ];
  state.assessment = {
    id: crypto.randomUUID(),
    incidentId,
    summary: `Strong recurrence detected. The verified memory "${match.title}" matches the current pool saturation, while MCP confirms the permanent leak detector and capacity guard is still incomplete. Restart alone would repeat the prior failure mode.`,
    matchStrength: "strong",
    memories: [match, ...(redHerring ? [redHerring] : [])],
    proposedActionIds: [actionId],
    citations: [match.id],
    toolTrace: trace,
    degraded: [],
    createdAt: new Date().toISOString(),
  };
  localEvent(state, incidentId, "agent", "recall_completed", "Verified recurrence found; one approval-gated action proposed");
  await wait(650);
  return saveLocal(state);
}

async function localDecision(actionId: string, decision: "approve" | "reject") {
  const state = loadLocal();
  const action = state.actions.find((item) => item.id === actionId);
  if (!action) throw new Error("Action not found");
  if (action.status === "pending_approval") {
    action.status = decision === "approve" ? "approved" : "rejected";
    localEvent(state, action.incidentId, "human", `action_${action.status}`, `${action.status}: ${action.title}`);
  }
  return saveLocal(state);
}

async function localComplete(actionId: string) {
  const state = loadLocal();
  const action = state.actions.find((item) => item.id === actionId);
  if (!action || action.status !== "approved") throw new Error("Approve the action before completion");
  action.status = "completed";
  localEvent(state, action.incidentId, "human", "action_completed", `Verification evidence attached: ${action.title}`);
  return saveLocal(state);
}

async function localResolve(incidentId: string) {
  const state = loadLocal();
  const incident = state.incidents.find((item) => item.id === incidentId);
  if (!incident) throw new Error("Incident not found");
  incident.status = "resolved";
  incident.resolvedAt = new Date().toISOString();
  incident.isCurrent = true;
  const existing = state.memories.find((memory) => memory.incidentId === incidentId && memory.kind === "postmortem");
  if (!existing) {
    state.memories.unshift({
      id: crypto.randomUUID(),
      incidentId,
      kind: "postmortem",
      service: incident.service,
      title: `Postmortem: ${incident.title}`,
      content: "Recall linked pool saturation to verified history, surfaced the unfinished capacity guard, and recorded human-approved completion evidence.",
      status: "proposed",
      confidence: 0.88,
      createdAt: new Date().toISOString(),
    });
  }
  localEvent(state, incidentId, "human", "incident_resolved", "Incident resolved; postmortem stored in S3 and proposed as memory");
  return saveLocal(state);
}

async function localVerify(memoryId: string) {
  const state = loadLocal();
  const memory = state.memories.find((item) => item.id === memoryId);
  if (!memory) throw new Error("Memory not found");
  memory.status = "verified";
  memory.lastVerifiedAt = new Date().toISOString();
  if (memory.incidentId) localEvent(state, memory.incidentId, "human", "memory_verified", `Verified durable memory: ${memory.title}`);
  return saveLocal(state);
}

export const clientApi = {
  async startSession() {
    return isCloudMode ? (await request<DashboardState>("/api/session", { method: "POST" })).data : loadLocal();
  },
  async state() {
    return isCloudMode ? (await request<DashboardState>("/api/state")).data : loadLocal();
  },
  async trigger() {
    if (!isCloudMode) return localTrigger();
    await request("/api/demo/trigger", { method: "POST" });
    for (let attempt = 0; attempt < 15; attempt++) {
      await wait(1_000);
      const state = (await request<DashboardState>("/api/state")).data;
      if (state.incidents.some((incident) => incident.externalRef === liveIncidentTemplate.externalRef)) return state;
    }
    throw new Error("Worker ingestion exceeded 15 seconds. Check the CloudWatch worker alarm.");
  },
  async recall(incidentId: string) {
    if (!isCloudMode) return localRecall(incidentId);
    const result = await request<{ state: DashboardState; matches: Memory[] }>(`/api/incidents/${incidentId}/recall`, { method: "POST" });
    return result.data.state;
  },
  async decide(actionId: string, decision: "approve" | "reject") {
    return isCloudMode
      ? (await request<DashboardState>(`/api/actions/${actionId}/decision`, { method: "POST", body: JSON.stringify({ decision }) })).data
      : localDecision(actionId, decision);
  },
  async complete(actionId: string) {
    return isCloudMode
      ? (await request<DashboardState>(`/api/actions/${actionId}/complete`, { method: "POST" })).data
      : localComplete(actionId);
  },
  async resolve(incidentId: string) {
    return isCloudMode
      ? (await request<DashboardState>(`/api/incidents/${incidentId}/resolve`, { method: "POST" })).data
      : localResolve(incidentId);
  },
  async verify(memoryId: string) {
    return isCloudMode
      ? (await request<DashboardState>(`/api/memories/${memoryId}/verify`, { method: "POST" })).data
      : localVerify(memoryId);
  },
  async reset() {
    if (isCloudMode) return (await request<DashboardState>("/api/session/reset", { method: "POST" })).data;
    localStorage.removeItem(storageKey);
    return loadLocal();
  },
};
