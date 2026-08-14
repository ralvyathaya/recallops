# ccloud provisioning and redacted evidence

These are the commands and sanitized outputs used for the deployed RecallOps cluster. No API key, password, connection string, AWS account ID, full CockroachDB cluster ID, or session cookie is committed here.

## Reproducible provisioning

RecallOps used `ccloud 0.6.12` (`CCAPI 2023-04-10`). In this CLI release the valid free plan name is `serverless`, and cluster inspection is `cluster info`:

```powershell
ccloud auth login
ccloud cluster create serverless recallops us-east-1 --cloud AWS --spend-limit 0
ccloud cluster info recallops -o json
```

The cluster was created successfully on AWS. The SQL administrator initialized [`../db/init.sql`](../db/init.sql), then granted the schema-defined runtime role to the separate application user:

```sql
GRANT recallops_runtime TO recallops_app;
SHOW GRANTS ON ROLE recallops_runtime;
```

The Lambda connection string uses `recallops_app`, database `recallops`, port `26257`, and `sslmode=verify-full`. The administrator credential is not used by the runtime.

## Cluster inspection — 2026-08-09

```text
Command: ccloud cluster info recallops -o json

name: recallops
id: [REDACTED]-3dba10
cloud_provider: AWS
plan: SERVERLESS
region: us-east-1 (primary)
state: CREATED
cockroach_version: v26.2.5
spend_limit: 0
network_visibility: PUBLIC
```

`ccloud cluster backup list` is not available in the installed CLI and is intentionally not claimed as evidence.

## Cluster-scoped MCP service account

The service account and one-time API key were created in CockroachDB Cloud Access Management because this `ccloud` release does not expose service-account creation commands. The API key was written directly to AWS Secrets Manager.

`ccloud` was then used to inspect the actual principal's grants:

```text
Command: ccloud role get [REDACTED_PRINCIPAL_ID] -o json

role: CLUSTER_OPERATOR_WRITER
resource.type: CLUSTER
resource.id: [REDACTED]-3dba10
organization role: ORG_MEMBER
```

This control-plane role is accurately described as Cluster Operator, not read-only. Runtime safety comes from the application boundary: [`../src/backend/mcp.ts`](../src/backend/mcp.ts) validates both IDs as UUIDs and invokes only the Managed MCP `select_query` tool with a fixed `SELECT id, title, status, risk, rationale, owner ... LIMIT 1` statement. The model cannot provide SQL or call MCP directly.

## Runtime SQL role proof

```text
Command: SHOW GRANTS ON ROLE recallops_runtime;

role_name          member          is_admin
recallops_runtime  recallops_app   false
```

The role's DML permissions are defined explicitly in [`../db/init.sql`](../db/init.sql); it cannot alter the schema.

## Distributed vector index proof

```text
Command: SHOW INDEXES FROM memories;

table_name  index_name                    column_name   definition
memories    memories_embedding_idx        workspace_id workspace_id
memories    memories_embedding_idx        embedding    embedding
memories    memories_embedding_idx        id           id (implicit)
```

The deployed index is a workspace-prefixed CockroachDB vector index:

```sql
CREATE VECTOR INDEX IF NOT EXISTS memories_embedding_idx
ON memories (workspace_id, embedding vector_cosine_ops);
```

Every live recall also persists the sanitized `EXPLAIN` result in `agent_runs.tool_trace`. The production UI shows its compact summary and exposes the complete plan under **View query plan**.

## Managed MCP runtime proof

Sanitized output from a successful production golden-path run:

```text
Tool: mcp.select_query
Cluster: [REDACTED]-3dba10
Statement: fixed SELECT of id, title, status, risk, rationale, and owner
Result: historical INC-1042 action inspected
Trace status: success
UI detail: MCP found approved incomplete action: Add connection leak detector and capacity guard
```

No Authorization header, MCP response payload, service-account secret, database URL, or complete identifier is stored in the repository.
