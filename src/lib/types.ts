export type IncidentStatus = "detected" | "investigating" | "mitigated" | "resolved";
export type MemoryStatus = "proposed" | "verified" | "stale" | "superseded";
export type ActionStatus = "pending_approval" | "approved" | "rejected" | "completed";
export type Risk = "low" | "medium" | "high";
export type Severity = "P1" | "P2" | "P3";

export interface Workspace {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface Incident {
  id: string;
  externalRef: string;
  service: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  summary: string;
  artifactKey?: string;
  startedAt: string;
  resolvedAt?: string;
  isCurrent?: boolean;
}

export interface IncidentEvent {
  id: string;
  incidentId: string;
  occurredAt: string;
  source: "cloudwatch" | "agent" | "human" | "system";
  eventType: string;
  message: string;
}

export interface Memory {
  id: string;
  incidentId?: string;
  kind: "runbook" | "diagnosis" | "mitigation" | "postmortem";
  service: string;
  title: string;
  content: string;
  status: MemoryStatus;
  confidence: number;
  similarity?: number;
  score?: number;
  matchLabel?: "strong" | "possible" | "weak";
  createdAt: string;
  lastVerifiedAt?: string;
  supersededBy?: string;
}

export interface ActionItem {
  id: string;
  incidentId: string;
  sourceMemoryId?: string;
  title: string;
  rationale: string;
  risk: Risk;
  status: ActionStatus;
  owner?: string;
  dueAt?: string;
  createdAt: string;
}

export interface ToolTrace {
  name: "vector_search" | "mcp.select_query" | "bedrock.converse" | "crdb.transaction";
  status: "success" | "degraded" | "skipped";
  latencyMs: number;
  detail: string;
}

export interface AgentAssessment {
  id: string;
  incidentId: string;
  summary: string;
  matchStrength: "strong" | "possible" | "none";
  memories: Memory[];
  proposedActionIds: string[];
  citations: string[];
  toolTrace: ToolTrace[];
  degraded: ("bedrock" | "mcp" | "artifact")[];
  createdAt: string;
}

export interface DashboardState {
  workspace: Workspace;
  incidents: Incident[];
  events: IncidentEvent[];
  memories: Memory[];
  actions: ActionItem[];
  assessment?: AgentAssessment;
}

export interface ApiEnvelope<T> {
  data: T;
  traceId: string;
  degraded?: ("bedrock" | "mcp" | "artifact")[];
  error?: { code: string; message: string };
}
