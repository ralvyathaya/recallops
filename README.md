<p align="center"><img src="public/recallops-mark.svg" width="72" alt="RecallOps memory loop logo"></p>

# RecallOps

**An incident-response agent that remembers whether the last fix actually finished.**

**[Open the live AWS demo](https://d309nxlq8e8jph.cloudfront.net)** · Synthetic incident data, real AWS and CockroachDB execution.

RecallOps is a public, approval-gated SRE war room. When a recurring incident arrives through CloudWatch, it stores the raw evidence in S3, retrieves trusted operational memory from CockroachDB's distributed vector index, verifies unfinished work through the CockroachDB Cloud Managed MCP server, and asks Amazon Bedrock for a grounded action proposal. A human must approve every action. Resolution creates a new postmortem memory that becomes reusable only after verification.

![RecallOps light operations console](docs/assets/recallops-light.png)

This repository contains a credential-free local mode and the complete AWS CDK/CockroachDB implementation. Local mode is clearly labeled **AWS simulated**; the deployed mode uses the real services.

## Quick tour

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then:

1. **Simulate incident** — a repeated `checkout-api` connection-pool failure appears.
2. **Recall past incidents** — the verified historical diagnosis ranks first, and the trace shows Vector → MCP → Bedrock → CockroachDB transaction.
3. **Approve**, **Mark completed**, then **Resolve incident**.
4. **Verify resolution**, refresh the page, and see that the learned state remains.

The browser uses `localStorage` only when `NEXT_PUBLIC_API_MODE=local`. Cloud mode never substitutes local state for CockroachDB.

A complete guided walkthrough:

1. `INC-1042` already shows an approved fix that remains incomplete — the gap RecallOps is designed to close.
2. Click **Simulate incident**. Within 15 seconds, `INC-2077` appears with `checkout-api`, P1 severity, and an S3 artifact indicator.
3. Click **Recall past incidents**. The first match is **Checkout database pool at 100% with acquire timeouts**, marked `verified` and `strong`.
4. The assessment warns that the restart was temporary and shows exactly one proposal: **Add connection leak detector and capacity guard**, recalled from unfinished work in `INC-1042`.
5. Expand **Agent tool trace** and inspect all four steps: `vector_search` with the `memories_embedding_idx` `EXPLAIN` detail, `mcp.select_query` verifying historical action state, `bedrock.converse` using Nova 2 Lite, and `crdb.transaction` storing the run and pending action atomically.
6. Click **Approve**, then **Mark completed**. Both human decisions enter the append-only timeline.
7. Click **Resolve incident**, then **Verify resolution**. The postmortem moves from `proposed` to `verified`.
8. Refresh the page. **Memory verified** and the incident state remain.

No button performs real infrastructure remediation. The action is a sandbox record and every mutation is human-approved.

## Seed history

Operational memory only proves its value when there is something trustworthy to recall. Every 24-hour sandbox starts with three clearly labeled synthetic incidents: one verified recurrence with an unfinished permanent fix and two realistic red herrings. The current `INC-2077` incident, embedding, retrieval scores, MCP verification, Bedrock assessment, approval record, postmortem, and verified memory are still created live through the production AWS and CockroachDB pipeline. No customer data or production remediation is involved.

## Why memory is the product

Traditional incident copilots summarize the current alert. RecallOps answers the operationally harder question: **did we finish the permanent fix last time?**

- Semantic memory finds a prior incident even when alert wording differs.
- Trust lifecycle prevents proposed or stale notes from authorizing recommendations.
- Transactional state joins memory, actions, approval, completion, and audit history without consistency gaps.
- A new postmortem is not trusted automatically; human verification closes the learning loop.
- Refreshing or retrying does not erase state or duplicate an incident.

## Architecture

```mermaid
flowchart LR
    User["User"] --> CF["CloudFront"]
    CF --> Web["Private S3 static dashboard"]
    CF --> API["API Gateway HTTP API"]
    API --> Lambda["API Lambda · Node.js 22"]
    Lambda --> CW["CloudWatch Logs"]
    Lambda --> S3["Versioned S3 evidence"]
    Lambda --> CRDB["CockroachDB Cloud"]
    Lambda --> MCP["Managed MCP · controlled verification"]
    Lambda --> BR["Amazon Bedrock"]
    CW --> Worker["Worker Lambda"]
    Worker --> S3
    Worker --> CRDB
    Worker --> BR
    EB["EventBridge hourly cleanup"] --> Worker
```

The frontend is a Next.js 15 static export. Two Lambda functions contain the runtime: one HTTP handler and one CloudWatch ingestion/cleanup worker. There is no ORM, agent framework, container, NAT gateway, or separate vector database.

## CockroachDB integrations

### 1. Distributed Vector Indexing

`memories.embedding` is `VECTOR(512)` and uses a workspace-prefixed cosine index:

```sql
VECTOR INDEX memories_embedding_idx
  (workspace_id, embedding vector_cosine_ops)
```

Titan Embeddings V2 creates normalized 512-dimensional embeddings. Recall takes 20 ANN candidates, reranks the best five using 70% semantic similarity, 15% same service, 10% verified status, and 5% recency. The persisted tool trace includes the `EXPLAIN` plan. Only verified memories scoring at least `0.60` can support an action. See [`db/init.sql`](db/init.sql) and [`src/backend/repository.ts`](src/backend/repository.ts).

### 2. CockroachDB Cloud Managed MCP

The runtime connects to `https://cockroachlabs.cloud/mcp` using a cluster-scoped service-account key. It discovers `select_query`, then executes one fixed query after UUID validation to inspect historical action state. The validated MCP result is the authoritative action supplied to Bedrock; direct SQL runs only as a visibly degraded fallback. The model never writes SQL. See [`src/backend/mcp.ts`](src/backend/mcp.ts).

### 3. Agent-ready `ccloud` CLI

The Serverless cluster is provisioned and inspected through `ccloud`; role grants are also verified through the CLI. The Managed MCP service account and API key are created in CockroachDB Cloud Access Management, then stored in AWS Secrets Manager. Reproducible commands and redacted real outputs are in [`docs/CCLOUD_EVIDENCE.md`](docs/CCLOUD_EVIDENCE.md). Admin credentials are used only for schema initialization; the runtime gets DML on the six application tables.

References: [vector indexes](https://www.cockroachlabs.com/docs/stable/vector-indexes), [ccloud command reference](https://www.cockroachlabs.com/docs/cockroachcloud/ccloud-reference), and [CockroachDB Cloud MCP](https://www.cockroachlabs.com/docs/cockroachcloud/connect-to-the-cockroachdb-cloud-mcp-server).

## AWS services

| Service | Role |
| --- | --- |
| Amazon Bedrock | Nova 2 Lite structured assessment and Titan Text Embeddings V2 |
| AWS Lambda | HTTP agent pipeline plus asynchronous ingestion/cleanup worker |
| Amazon S3 | Private, versioned incident artifacts and Markdown postmortems |
| CloudWatch Logs | Structured incident signal and observable JSON runtime logs |
| API Gateway | Same-origin HTTP API behind CloudFront with throttling |
| CloudFront | TLS edge and routing for the static app plus `/api/*` |
| EventBridge | Hourly deletion of expired 24-hour sandboxes |
| Secrets Manager | CockroachDB URL, MCP credentials, and generated HMAC secret |

Bedrock uses `global.amazon.nova-2-lite-v1:0` with temperature `0` and forced `record_assessment` tool output. Embeddings use `amazon.titan-embed-text-v2:0`, 512 dimensions, normalized. No hidden reasoning is stored. References: [Nova 2 Lite](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-nova-2-lite.html) and [Titan Text Embeddings V2](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-amazon-titan-text-embeddings-v2.html).

## Persistent data model

| Table | Durable responsibility |
| --- | --- |
| `workspaces` | Isolated public sandbox and 24-hour expiry |
| `incidents` | Incident identity, lifecycle, service, severity, and artifact pointer |
| `incident_events` | Append-only timeline and human/agent audit trail |
| `memories` | Trusted lifecycle, confidence, source incident, and vector embedding |
| `action_items` | Proposal, approval, completion, owner, risk, and source memory |
| `agent_runs` | Final assessment, citations, retrieval result, tool trace, latency, and degraded state |

Approval and completion use conditional updates inside CockroachDB transactions. SQLSTATE `40001` retries up to three times with jitter. Unique `(workspace_id, external_ref)` makes duplicate CloudWatch delivery safe.

## Repository map

```text
db/init.sql                    CockroachDB schema, vector index, runtime grants
infra/                         AWS CDK stack
src/backend/api-handler.ts     Public HTTP Lambda
src/backend/worker-handler.ts  CloudWatch ingestion + cleanup Lambda
src/backend/repository.ts      Transactions and persistent memory operations
src/backend/mcp.ts             Fixed-query Managed MCP verification
src/backend/bedrock.ts         Embeddings and structured assessment
src/components/dashboard.tsx   War-room UI
test/                          Deterministic unit tests
e2e/                           Playwright golden-path E2E
```

## Local development

Requirements: Node.js 22 and npm 10+.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Keep `NEXT_PUBLIC_API_MODE=local`. No AWS or CockroachDB credential is needed. The deterministic local path mirrors the state machine and is intended for UI review, development, and CI — not as evidence that cloud integrations ran.

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run cdk:synth
npx playwright install chromium
npm run test:e2e
```

With a real CockroachDB URL and Bedrock credentials, run the 15-query retrieval gate:

```bash
npm run eval:retrieval
```

It fails unless Recall@3 is at least 80% and the core connection-pool scenario ranks first.

## Cloud deployment

Prerequisites:

- AWS account authenticated locally, AWS CLI, and CDK v2 bootstrap in `us-east-1`.
- CockroachDB Cloud account and `ccloud` CLI.
- Bedrock access to Nova 2 Lite and Titan Text Embeddings V2 in the target account.
- A CockroachDB Serverless cluster and separate admin/runtime SQL credentials.
- A cluster-scoped Managed MCP service-account API key.

### 1. Provision CockroachDB

Follow [`docs/CCLOUD_EVIDENCE.md`](docs/CCLOUD_EVIDENCE.md), obtain an admin SQL URL, and initialize the schema:

```bash
DATABASE_URL='postgresql://admin:.../defaultdb?sslmode=verify-full' npm run db:init
```

Create a runtime SQL user, grant it the `recallops_runtime` role, and use that user's URL in production. Do not place the admin URL in Lambda.

### 2. Deploy AWS resources

```bash
npx cdk bootstrap aws://ACCOUNT_ID/us-east-1
NEXT_PUBLIC_API_MODE=cloud npm run build
npx cdk deploy
```

The stack outputs the CloudFront demo URL and three secret names. Replace only the placeholder secrets:

```bash
aws secretsmanager put-secret-value \
  --secret-id DATABASE_SECRET_NAME \
  --secret-string '{"url":"postgresql://runtime:REDACTED@HOST:26257/recallops?sslmode=verify-full"}'

aws secretsmanager put-secret-value \
  --secret-id MCP_SECRET_NAME \
  --secret-string '{"apiKey":"REDACTED","clusterId":"CLUSTER_UUID"}'
```

Do not replace the generated session secret. Redeploy after rebuilding whenever `NEXT_PUBLIC_API_MODE` changes because it is compiled into the static frontend.

### 3. Verify production

1. Open the CloudFront URL in an incognito window.
2. Complete the guided walkthrough above three times.
3. Confirm `SHOW INDEXES FROM memories` contains `memories_embedding_idx`.
4. Expand the UI trace and confirm `mcp.select_query` and `bedrock.converse` are successful.
5. Refresh after verification and confirm the learned postmortem persists.

Expected degradation behavior:

- `MCP degraded`: direct parameterized read is used; recall may continue.
- `Bedrock degraded`: retrieval remains visible; no new action is created.
- `Artifact degraded`: incident remains usable; evidence loss is explicit.

## Security and failure behavior

- The site and evidence buckets are private; CloudFront uses Origin Access Control.
- Session cookies are HMAC-signed, `Secure`, `HttpOnly`, `SameSite=Lax`, and expire after 24 hours.
- Public input is limited to fixed demo commands and UUIDs. There is no upload or arbitrary SQL endpoint.
- Runtime database access is DML-only. MCP uses a separate cluster-scoped service account, while the application exposes only a fixed, UUID-validated `select_query` call.
- Recall is limited to five calls per minute and 30 per sandbox per day; API Gateway throttling provides an additional cost boundary.
- Missing S3 evidence does not erase the incident; it is marked degraded.
- MCP failure uses a safe direct-read fallback and is visibly degraded.
- Bedrock failure returns retrieval-only evidence and creates no action.
- Logs contain trace ID, incident ID, stage, and latency — not secrets, raw prompts, or hidden reasoning.
- CloudWatch alarms cover API errors, worker errors, and API 5xx responses.

## Teardown

These commands delete cloud resources and data. Confirm the target account and cluster first:

```bash
npx cdk destroy
ccloud cluster delete recallops
```

## License

[MIT](LICENSE)
