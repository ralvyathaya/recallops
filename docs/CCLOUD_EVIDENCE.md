# ccloud provisioning and evidence

This file is both the reproducible runbook and the submission evidence template. Commands follow the current [`ccloud` reference](https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference). **Do not paste API secrets, SQL passwords, connection strings, account IDs, or unsanitized output into the repository.**

## Provisioning commands

```bash
ccloud auth login
ccloud cluster create basic recallops us-east-1 --cloud AWS --spend-limit 50
ccloud cluster get recallops
ccloud cluster backup list recallops

ccloud service-account create recallops-mcp --description "RecallOps read-only Managed MCP runtime"
ccloud service-account api-key create SERVICE_ACCOUNT_ID recallops-mcp-key
```

Choose a spend limit appropriate to the account. Store the one-time API-key secret directly in AWS Secrets Manager. Assign the service account only the read-only role scoped to the RecallOps cluster in CockroachDB Cloud Access Management.

Create separate SQL users in the cluster. Initialize [`../db/init.sql`](../db/init.sql) with the admin URL, then grant the runtime role:

```sql
CREATE USER recallops_app WITH PASSWORD 'generated-outside-git';
GRANT recallops_runtime TO recallops_app;
```

The Lambda connection string must use `recallops_app`, database `recallops`, port `26257`, and `sslmode=verify-full`.

## Redacted submission evidence

Populate this section only after the real cluster exists.

### Cluster create

```text
Command: ccloud cluster create basic recallops us-east-1 --cloud AWS --spend-limit [REDACTED]
Result: [PENDING REAL DEPLOYMENT]
Cluster ID: [REDACTED except final 6 characters]
Region: [PENDING]
Plan: [PENDING]
CockroachDB version: [PENDING]
```

### Cluster inspection and managed backup

```text
Command: ccloud cluster get recallops
Sanitized output: [PENDING REAL DEPLOYMENT]

Command: ccloud cluster backup list recallops
Sanitized output: [PENDING REAL DEPLOYMENT]
```

### Service account

```text
Command: ccloud service-account get [REDACTED_ID]
Name: [PENDING]
Cluster role: [PENDING — must be read-only]
API key ID: [REDACTED]
API key secret: NEVER COMMIT
```

### Vector index proof

Run with an admin or diagnostic SQL connection:

```sql
SHOW INDEXES FROM recallops.public.memories;
EXPLAIN SELECT id
FROM recallops.public.memories
WHERE workspace_id = 'SANDBOX_UUID'
ORDER BY embedding <=> '[REDACTED_512_DIM_VECTOR]'::VECTOR
LIMIT 20;
```

```text
SHOW INDEXES sanitized result: [PENDING REAL DEPLOYMENT]
EXPLAIN sanitized result: [PENDING REAL DEPLOYMENT]
Expected index name: memories_embedding_idx
```

### Managed MCP proof

Capture the expanded trace from the production UI. It must show:

```text
Tool: mcp.select_query
Mode: read-only
Cluster: [REDACTED except final 6 characters]
Result fields: id, title, status, risk
Status: [PENDING REAL DEPLOYMENT]
```

Never include the Authorization header, service-account secret, database URL, raw session cookie, or complete cluster identifier.
