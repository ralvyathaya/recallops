CREATE DATABASE IF NOT EXISTS recallops;
USE recallops;

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  external_ref STRING(80) NOT NULL,
  service STRING(100) NOT NULL,
  title STRING(240) NOT NULL,
  severity STRING(2) NOT NULL CHECK (severity IN ('P1', 'P2', 'P3')),
  status STRING(20) NOT NULL CHECK (status IN ('detected', 'investigating', 'mitigated', 'resolved')),
  summary STRING(4000) NOT NULL,
  artifact_key STRING(500),
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  UNIQUE (workspace_id, external_ref),
  INDEX incidents_workspace_status_idx (workspace_id, status, started_at DESC)
);

CREATE TABLE IF NOT EXISTS incident_events (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source STRING(20) NOT NULL,
  event_type STRING(80) NOT NULL,
  message STRING(4000) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  INDEX events_workspace_incident_idx (workspace_id, incident_id, occurred_at)
);

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES incidents(id) ON DELETE SET NULL,
  kind STRING(20) NOT NULL CHECK (kind IN ('runbook', 'diagnosis', 'mitigation', 'postmortem')),
  service STRING(100) NOT NULL,
  title STRING(240) NOT NULL,
  content STRING(8000) NOT NULL,
  status STRING(20) NOT NULL CHECK (status IN ('proposed', 'verified', 'stale', 'superseded')),
  confidence DECIMAL(5,4) NOT NULL,
  embedding VECTOR(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ,
  superseded_by UUID REFERENCES memories(id),
  VECTOR INDEX memories_embedding_idx (workspace_id, embedding vector_cosine_ops)
);

CREATE TABLE IF NOT EXISTS action_items (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  source_memory_id UUID REFERENCES memories(id) ON DELETE SET NULL,
  title STRING(500) NOT NULL,
  rationale STRING(4000) NOT NULL,
  risk STRING(10) NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  status STRING(30) NOT NULL CHECK (status IN ('pending_approval', 'approved', 'rejected', 'completed')),
  owner STRING(120),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  INDEX actions_workspace_incident_idx (workspace_id, incident_id, status)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  model_id STRING(200) NOT NULL,
  summary STRING(4000),
  match_strength STRING(20),
  tool_trace JSONB NOT NULL DEFAULT '[]'::JSONB,
  citations JSONB NOT NULL DEFAULT '[]'::JSONB,
  retrieval JSONB NOT NULL DEFAULT '[]'::JSONB,
  degraded JSONB NOT NULL DEFAULT '[]'::JSONB,
  latency_ms INT8 NOT NULL DEFAULT 0,
  error STRING(1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX agent_runs_workspace_created_idx (workspace_id, created_at DESC)
);

CREATE ROLE IF NOT EXISTS recallops_runtime;
GRANT CONNECT ON DATABASE recallops TO recallops_runtime;
GRANT USAGE ON SCHEMA public TO recallops_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  workspaces, incidents, incident_events, memories, action_items, agent_runs
TO recallops_runtime;
