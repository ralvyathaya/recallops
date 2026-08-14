import type { PoolClient, QueryResultRow } from "pg";
import { createScenario } from "@/lib/scenario";
import { rerankMemories } from "@/lib/ranking";
import type {
  ActionItem,
  ActionStatus,
  AgentAssessment,
  DashboardState,
  Incident,
  IncidentEvent,
  Memory,
  ToolTrace,
} from "@/lib/types";
import type { AssessmentInput } from "./bedrock";
import { embedText } from "./bedrock";
import { query, vectorLiteral, withTransaction } from "./db";

type Row = QueryResultRow & Record<string, unknown>;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const optionalIso = (value: unknown) => value ? iso(value) : undefined;

export function transactionTrace(actionCount: number, startedAt: number): ToolTrace {
  return {
    name: "crdb.transaction",
    status: "success",
    latencyMs: Math.max(1, Date.now() - startedAt),
    detail: `Atomic agent run + ${actionCount} pending action(s); SQLSTATE 40001 retry enabled`,
  };
}

function mapIncident(row: Row): Incident {
  return {
    id: String(row.id),
    externalRef: String(row.external_ref),
    service: String(row.service),
    title: String(row.title),
    severity: row.severity as Incident["severity"],
    status: row.status as Incident["status"],
    summary: String(row.summary),
    artifactKey: row.artifact_key ? String(row.artifact_key) : undefined,
    startedAt: iso(row.started_at),
    resolvedAt: optionalIso(row.resolved_at),
  };
}

function mapEvent(row: Row): IncidentEvent {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    occurredAt: iso(row.occurred_at),
    source: row.source as IncidentEvent["source"],
    eventType: String(row.event_type),
    message: String(row.message),
  };
}

function mapMemory(row: Row): Memory {
  return {
    id: String(row.id),
    incidentId: row.incident_id ? String(row.incident_id) : undefined,
    kind: row.kind as Memory["kind"],
    service: String(row.service),
    title: String(row.title),
    content: String(row.content),
    status: row.status as Memory["status"],
    confidence: Number(row.confidence),
    similarity: row.similarity == null ? undefined : Number(row.similarity),
    createdAt: iso(row.created_at),
    lastVerifiedAt: optionalIso(row.last_verified_at),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
  };
}

function mapAction(row: Row): ActionItem {
  return {
    id: String(row.id),
    incidentId: String(row.incident_id),
    sourceMemoryId: row.source_memory_id ? String(row.source_memory_id) : undefined,
    title: String(row.title),
    rationale: String(row.rationale),
    risk: row.risk as ActionItem["risk"],
    status: row.status as ActionStatus,
    owner: row.owner ? String(row.owner) : undefined,
    dueAt: optionalIso(row.due_at),
    createdAt: iso(row.created_at),
  };
}

async function insertEvent(
  client: PoolClient,
  workspaceId: string,
  incidentId: string,
  source: IncidentEvent["source"],
  eventType: string,
  message: string,
) {
  await client.query(
    `INSERT INTO incident_events (id, workspace_id, incident_id, source, event_type, message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [crypto.randomUUID(), workspaceId, incidentId, source, eventType, message],
  );
}

export async function ensureWorkspace(workspaceId: string) {
  const existing = await query<Row>("SELECT id FROM workspaces WHERE id = $1", [workspaceId]);
  if (existing.rowCount) return;
  const scenario = createScenario(workspaceId);
  const embeddings = await Promise.all(scenario.memories.map((memory) => embedText(`${memory.title}\n${memory.content}`)));
  await withTransaction(async (client) => {
    const created = await client.query(
      `INSERT INTO workspaces (id, expires_at) VALUES ($1, now() + INTERVAL '24 hours')
       ON CONFLICT (id) DO NOTHING RETURNING id`,
      [workspaceId],
    );
    if (created.rowCount === 0) return;

    for (const incident of scenario.incidents) {
      await client.query(
        `INSERT INTO incidents
          (id, workspace_id, external_ref, service, title, severity, status, summary, started_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [incident.id, workspaceId, incident.externalRef, incident.service, incident.title, incident.severity,
          incident.status, incident.summary, incident.startedAt, incident.resolvedAt],
      );
    }
    for (let index = 0; index < scenario.memories.length; index++) {
      const memory = scenario.memories[index];
      await client.query(
        `INSERT INTO memories
          (id, workspace_id, incident_id, kind, service, title, content, status, confidence, embedding, created_at, last_verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::VECTOR,$11,$12)`,
        [memory.id, workspaceId, memory.incidentId, memory.kind, memory.service, memory.title, memory.content,
          memory.status, memory.confidence, vectorLiteral(embeddings[index]), memory.createdAt, memory.lastVerifiedAt],
      );
    }
    for (const event of scenario.events) {
      await client.query(
        `INSERT INTO incident_events (id, workspace_id, incident_id, occurred_at, source, event_type, message)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [event.id, workspaceId, event.incidentId, event.occurredAt, event.source, event.eventType, event.message],
      );
    }
    for (const action of scenario.actions) {
      await client.query(
        `INSERT INTO action_items
          (id, workspace_id, incident_id, source_memory_id, title, rationale, risk, status, owner, due_at, created_at, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [action.id, workspaceId, action.incidentId, action.sourceMemoryId, action.title, action.rationale,
          action.risk, action.status, action.owner, action.dueAt, action.createdAt],
      );
    }
  });
}

export async function getState(workspaceId: string): Promise<DashboardState> {
  const [workspaceResult, incidentsResult, eventsResult, memoriesResult, actionsResult, runsResult] = await Promise.all([
    query<Row>("SELECT id, created_at, expires_at FROM workspaces WHERE id = $1", [workspaceId]),
    query<Row>("SELECT * FROM incidents WHERE workspace_id = $1 ORDER BY started_at DESC", [workspaceId]),
    query<Row>("SELECT * FROM incident_events WHERE workspace_id = $1 ORDER BY occurred_at ASC", [workspaceId]),
    query<Row>("SELECT * FROM memories WHERE workspace_id = $1 ORDER BY created_at DESC", [workspaceId]),
    query<Row>("SELECT * FROM action_items WHERE workspace_id = $1 ORDER BY created_at DESC", [workspaceId]),
    query<Row>("SELECT * FROM agent_runs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1", [workspaceId]),
  ]);
  const workspace = workspaceResult.rows[0];
  if (!workspace) throw new Error("Workspace not found");
  const incidents = incidentsResult.rows.map(mapIncident);
  const run = runsResult.rows[0];
  const current = incidents.find((incident) => incident.status !== "resolved")
    ?? (run ? incidents.find((incident) => incident.id === String(run.incident_id)) : undefined);
  if (current) current.isCurrent = true;
  const memories = memoriesResult.rows.map(mapMemory);
  const actions = actionsResult.rows.map(mapAction);
  let assessment: AgentAssessment | undefined;
  if (run) {
    const citations = (run.citations as string[]) ?? [];
    const retrieval = (run.retrieval as Memory[]) ?? [];
    assessment = {
      id: String(run.id),
      incidentId: String(run.incident_id),
      summary: String(run.summary ?? ""),
      matchStrength: (run.match_strength ?? "none") as AgentAssessment["matchStrength"],
      memories: retrieval.length ? retrieval : memories.filter((memory) => citations.includes(memory.id)),
      proposedActionIds: actions
        .filter((action) => action.incidentId === String(run.incident_id))
        .map((action) => action.id),
      citations,
      toolTrace: (run.tool_trace as ToolTrace[]) ?? [],
      degraded: (run.degraded as AgentAssessment["degraded"]) ?? [],
      createdAt: iso(run.created_at),
    };
  }
  return {
    workspace: { id: String(workspace.id), createdAt: iso(workspace.created_at), expiresAt: iso(workspace.expires_at) },
    incidents,
    events: eventsResult.rows.map(mapEvent),
    memories,
    actions,
    assessment,
  };
}

export async function getIncident(workspaceId: string, incidentId: string) {
  const result = await query<Row>("SELECT * FROM incidents WHERE workspace_id = $1 AND id = $2", [workspaceId, incidentId]);
  return result.rows[0] ? mapIncident(result.rows[0]) : undefined;
}

export async function ingestIncident(
  workspaceId: string,
  input: Omit<Incident, "id" | "startedAt" | "status"> & { startedAt?: string; embedding: number[] },
) {
  return withTransaction(async (client) => {
    const id = crypto.randomUUID();
    const inserted = await client.query<Row>(
      `INSERT INTO incidents
        (id, workspace_id, external_ref, service, title, severity, status, summary, artifact_key, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'investigating',$7,$8,$9)
       ON CONFLICT (workspace_id, external_ref) DO NOTHING RETURNING *`,
      [id, workspaceId, input.externalRef, input.service, input.title, input.severity, input.summary,
        input.artifactKey ?? null, input.startedAt ?? new Date().toISOString()],
    );
    if (inserted.rows[0]) {
      await client.query(
        `INSERT INTO memories
          (id, workspace_id, incident_id, kind, service, title, content, status, confidence, embedding)
         VALUES ($1,$2,$3,'diagnosis',$4,$5,$6,'proposed',0.55,$7::VECTOR)`,
        [crypto.randomUUID(), workspaceId, id, input.service, `Live signal: ${input.title}`, input.summary, vectorLiteral(input.embedding)],
      );
      await insertEvent(client, workspaceId, id, "cloudwatch", "incident_detected", `${input.externalRef} detected from CloudWatch signal`);
      await insertEvent(client, workspaceId, id, "system", "artifact_ingested", input.artifactKey ? "Evidence stored in versioned S3" : "Incident stored without artifact");
      return mapIncident(inserted.rows[0]);
    }
    const existing = await client.query<Row>(
      "SELECT * FROM incidents WHERE workspace_id = $1 AND external_ref = $2",
      [workspaceId, input.externalRef],
    );
    return mapIncident(existing.rows[0]);
  });
}

export async function retrieveMemories(workspaceId: string, incident: Incident, embedding: number[]) {
  const vector = vectorLiteral(embedding);
  const result = await query<Row>(
    `SELECT id, incident_id, kind, service, title, content, status, confidence,
            created_at, last_verified_at, superseded_by, 1 - (embedding <=> $2::VECTOR) AS similarity
       FROM memories
      WHERE workspace_id = $1 AND (incident_id IS NULL OR incident_id <> $3)
      ORDER BY embedding <=> $2::VECTOR
      LIMIT 20`,
    [workspaceId, vector, incident.id],
  );
  const candidates = result.rows.map((row) => ({ ...mapMemory(row), similarity: Number(row.similarity) }));
  const matches = rerankMemories(candidates, incident.service);
  let explain = "Vector index plan unavailable";
  try {
    const plan = await query<Row>(
      "EXPLAIN SELECT id FROM memories WHERE workspace_id = $1 AND (incident_id IS NULL OR incident_id <> $3) ORDER BY embedding <=> $2::VECTOR LIMIT 20",
      [workspaceId, vector, incident.id],
    );
    explain = plan.rows.map((row) => String(Object.values(row)[0])).join(" · ").slice(0, 1200);
  } catch {
    explain = "Vector search succeeded; EXPLAIN was unavailable";
  }
  return { matches, explain };
}

export async function getOpenActionForIncident(workspaceId: string, incidentId: string) {
  const result = await query<Row>(
    `SELECT * FROM action_items
      WHERE workspace_id = $1 AND incident_id = $2 AND status IN ('pending_approval','approved')
      ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, incidentId],
  );
  return result.rows[0] ? mapAction(result.rows[0]) : undefined;
}

export async function saveAssessment(
  workspaceId: string,
  incidentId: string,
  assessment: AssessmentInput,
  memories: Memory[],
  toolTrace: ToolTrace[],
  degraded: AgentAssessment["degraded"],
  latencyMs: number,
  modelId: string,
) {
  const transactionStarted = Date.now();
  return withTransaction(async (client) => {
    const runId = crypto.randomUUID();
    const actionIds: string[] = [];
    const trustedCitation = assessment.citations.find((id) =>
      memories.some((memory) => memory.id === id && memory.status === "verified" && (memory.score ?? 0) >= 0.6));
    for (const action of assessment.actions) {
      if (!trustedCitation) break;
      const id = crypto.randomUUID();
      await client.query(
        `INSERT INTO action_items
          (id, workspace_id, incident_id, source_memory_id, title, rationale, risk, status, owner)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_approval',$8)`,
        [id, workspaceId, incidentId, trustedCitation, action.title, action.rationale, action.risk, action.owner],
      );
      actionIds.push(id);
    }
    const persistedTrace: ToolTrace[] = [...toolTrace, transactionTrace(actionIds.length, transactionStarted)];
    await client.query(
      `INSERT INTO agent_runs
        (id, workspace_id, incident_id, model_id, summary, match_strength, tool_trace, citations, retrieval, degraded, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7::JSONB,$8::JSONB,$9::JSONB,$10::JSONB,$11)`,
      [runId, workspaceId, incidentId, modelId, assessment.summary, assessment.matchStrength,
        JSON.stringify(persistedTrace), JSON.stringify(assessment.citations), JSON.stringify(memories.slice(0, 5)), JSON.stringify(degraded), latencyMs],
    );
    await insertEvent(client, workspaceId, incidentId, "agent", "recall_completed",
      `Recalled ${assessment.citations.length} cited memories and proposed ${actionIds.length} approval-gated action`);
    return { runId, actionIds, persistedTrace };
  });
}

export async function decideAction(workspaceId: string, actionId: string, decision: "approve" | "reject") {
  const desired: ActionStatus = decision === "approve" ? "approved" : "rejected";
  return withTransaction(async (client) => {
    const updated = await client.query<Row>(
      `UPDATE action_items SET status = $3, approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE approved_at END
        WHERE workspace_id = $1 AND id = $2 AND status = 'pending_approval' RETURNING *`,
      [workspaceId, actionId, desired],
    );
    const current = updated.rows[0] ?? (await client.query<Row>(
      "SELECT * FROM action_items WHERE workspace_id = $1 AND id = $2", [workspaceId, actionId],
    )).rows[0];
    if (!current) throw new Error("Action not found");
    if (current.status !== desired) throw new Error(`Action is already ${current.status}`);
    if (updated.rows[0]) await insertEvent(client, workspaceId, String(current.incident_id), "human", `action_${desired}`, `${desired}: ${current.title}`);
    return mapAction(current);
  });
}

export async function completeAction(workspaceId: string, actionId: string) {
  return withTransaction(async (client) => {
    const updated = await client.query<Row>(
      `UPDATE action_items SET status = 'completed', completed_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status = 'approved' RETURNING *`,
      [workspaceId, actionId],
    );
    const current = updated.rows[0] ?? (await client.query<Row>(
      "SELECT * FROM action_items WHERE workspace_id = $1 AND id = $2", [workspaceId, actionId],
    )).rows[0];
    if (!current) throw new Error("Action not found");
    if (current.status !== "completed") throw new Error(`Action must be approved before completion (current: ${current.status})`);
    if (updated.rows[0]) await insertEvent(client, workspaceId, String(current.incident_id), "human", "action_completed", `Completed with verification evidence: ${current.title}`);
    return mapAction(current);
  });
}

export async function resolveIncident(
  workspaceId: string,
  incidentId: string,
  artifactKey: string | undefined,
  embedding: number[],
) {
  return withTransaction(async (client) => {
    const completed = await client.query(
      "SELECT id FROM action_items WHERE workspace_id = $1 AND incident_id = $2 AND status = 'completed' LIMIT 1",
      [workspaceId, incidentId],
    );
    if (!completed.rowCount) throw new Error("At least one approved action must be completed before resolution");
    const incidentResult = await client.query<Row>(
      `UPDATE incidents SET status = 'resolved', resolved_at = now(), artifact_key = COALESCE($3, artifact_key)
        WHERE workspace_id = $1 AND id = $2 AND status <> 'resolved' RETURNING *`,
      [workspaceId, incidentId, artifactKey ?? null],
    );
    const incident = incidentResult.rows[0] ?? (await client.query<Row>(
      "SELECT * FROM incidents WHERE workspace_id = $1 AND id = $2", [workspaceId, incidentId],
    )).rows[0];
    if (!incident) throw new Error("Incident not found");
    const existing = await client.query<Row>(
      "SELECT * FROM memories WHERE workspace_id = $1 AND incident_id = $2 AND kind = 'postmortem' LIMIT 1",
      [workspaceId, incidentId],
    );
    let memory = existing.rows[0];
    if (!memory) {
      const id = crypto.randomUUID();
      const content = `Symptoms matched prior connection-pool exhaustion. The unresolved capacity guard was surfaced, approved, and verified before resolution. Source artifact: ${artifactKey ?? "unavailable"}.`;
      memory = (await client.query<Row>(
        `INSERT INTO memories
          (id, workspace_id, incident_id, kind, service, title, content, status, confidence, embedding)
         VALUES ($1,$2,$3,'postmortem',$4,$5,$6,'proposed',0.88,$7::VECTOR) RETURNING *`,
        [id, workspaceId, incidentId, incident.service, `Postmortem: ${incident.title}`, content, vectorLiteral(embedding)],
      )).rows[0];
      await insertEvent(client, workspaceId, incidentId, "agent", "memory_proposed", "Postmortem memory proposed; human verification required");
    }
    if (incidentResult.rows[0]) await insertEvent(client, workspaceId, incidentId, "human", "incident_resolved", "Incident resolved after approval-gated remediation");
    return { incident: mapIncident(incident), memory: mapMemory(memory) };
  });
}

export async function verifyMemory(workspaceId: string, memoryId: string) {
  return withTransaction(async (client) => {
    const selected = await client.query<Row>(
      `UPDATE memories SET status = 'verified', last_verified_at = now()
        WHERE workspace_id = $1 AND id = $2 AND status IN ('proposed','stale') RETURNING *`,
      [workspaceId, memoryId],
    );
    const memory = selected.rows[0] ?? (await client.query<Row>(
      "SELECT * FROM memories WHERE workspace_id = $1 AND id = $2", [workspaceId, memoryId],
    )).rows[0];
    if (!memory) throw new Error("Memory not found");
    if (memory.status !== "verified") throw new Error(`Memory is ${memory.status} and cannot be verified`);
    if (selected.rows[0]) {
      await client.query(
        `UPDATE memories SET status = 'superseded', superseded_by = $2
          WHERE workspace_id = $1 AND id <> $2 AND service = $3 AND kind = $4
            AND status IN ('proposed','stale') AND created_at < $5`,
        [workspaceId, memoryId, memory.service, memory.kind, memory.created_at],
      );
      if (memory.incident_id) await insertEvent(client, workspaceId, String(memory.incident_id), "human", "memory_verified", `Verified durable memory: ${memory.title}`);
    }
    return mapMemory(memory);
  });
}

export async function resetWorkspace(workspaceId: string) {
  await query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
  await ensureWorkspace(workspaceId);
}

export async function cleanupExpiredWorkspaces() {
  const result = await query("DELETE FROM workspaces WHERE expires_at < now()");
  return result.rowCount ?? 0;
}

export async function assertRecallRate(workspaceId: string) {
  const result = await query<Row>(
    `SELECT
       count(*) FILTER (WHERE created_at > now() - INTERVAL '1 minute') AS minute_count,
       count(*) FILTER (WHERE created_at > now() - INTERVAL '1 day') AS day_count
     FROM agent_runs WHERE workspace_id = $1`,
    [workspaceId],
  );
  if (Number(result.rows[0]?.minute_count ?? 0) >= 5 || Number(result.rows[0]?.day_count ?? 0) >= 30) {
    throw new Error("Recall rate limit reached; retry later");
  }
}
