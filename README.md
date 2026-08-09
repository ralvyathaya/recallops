# RecallOps

**An incident-response agent that remembers whether the last fix actually finished.**

RecallOps is a public, approval-gated SRE war room. When a recurring incident arrives through CloudWatch, it stores the raw evidence in S3, retrieves trusted operational memory from CockroachDB's distributed vector index, verifies unfinished work through the CockroachDB Cloud Managed MCP server, and asks Amazon Bedrock for a grounded action proposal. A human must approve every action. Resolution creates a new postmortem memory that becomes reusable only after verification.

This repository includes a credential-free local judge mode and the complete AWS CDK/CockroachDB implementation. Local mode is clearly labeled **AWS simulated**; the deployed mode uses the real services.

## The 30-second proof

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, then:

1. **Simulate incident** — a repeated `checkout-api` connection-pool failure appears.
2. **Recall past incidents** — the verified historical diagnosis ranks first, and the trace shows Vector → MCP → Bedrock → CockroachDB transaction.
3. **Approve**, **Mark completed**, then **Resolve incident**.
4. **Verify resolution**, refresh the page, and see that the learned state remains.

The browser demo uses `localStorage` only when `NEXT_PUBLIC_API_MODE=local`. Cloud mode never substitutes local state for CockroachDB.

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
    Judge["Judge"] --> CF["CloudFront"]
    CF --> Web["Private S3 static dashboard"]
    CF --> API["API Gateway HTTP API"]
    API --> Lambda["API Lambda · Node.js 22"]
    Lambda --> CW["CloudWatch Logs"]
    Lambda --> S3["Versioned S3 evidence"]
    Lambda --> CRDB["CockroachDB Cloud"]
    Lambda --> MCP["Managed MCP · read only"]
    Lambda --> BR["Amazon Bedrock"]
    CW --> Worker["Worker Lambda"]
    Worker --> S3
    Worker --> CRDB
    Worker --> BR
    EB["EventBridge hourly cleanup"] --> Worker
```

The frontend is a Next.js 15 static export. Two Lambda functions contain the runtime: one HTTP handler and one CloudWatch ingestion/cleanup worker. There is no ORM, agent framework, container, NAT gateway, or separate vector database.

## CockroachDB challenge tools

### 1. Distributed Vector Indexing

`memories.embedding` is `VECTOR(512)` and uses a workspace-prefixed cosine index:

```sql
VECTOR INDEX memories_embedding_idx
  (workspace_id, embedding vector_cosine_ops)
```

Titan Embeddings V2 creates normalized 512-dimensional embeddings. Recall takes 20 ANN candidates, reranks the best five using 70% semantic similarity, 15% same service, 10% verified status, and 5% recency. The persisted tool trace includes the `EXPLAIN` plan. Only verified memories scoring at least `0.60` can support an action. See [`db/init.sql`](db/init.sql) and [`src/backend/repository.ts`](src/backend/repository.ts).

### 2. CockroachDB Cloud Managed MCP

The runtime connects to `https://cockroachlabs.cloud/mcp` using a cluster-scoped service-account key. It discovers `select_query`, then executes one fixed query after UUID validation to inspect historical action state. The model never writes SQL. If MCP is unavailable, RecallOps performs the equivalent parameterized direct read and exposes `MCP degraded` in the UI and trace. See [`src/backend/mcp.ts`](src/backend/mcp.ts).

### 3. Agent-ready `ccloud` CLI

The cluster, service account, API key, cluster inspection, and backup check are managed through `ccloud`. Reproducible commands and a redacted evidence template are in [`docs/CCLOUD_EVIDENCE.md`](docs/CCLOUD_EVIDENCE.md). Admin credentials are used only for schema initialization; the runtime gets DML on the six application tables.

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
src/backend/mcp.ts             Read-only Managed MCP verification
src/backend/bedrock.ts         Embeddings and structured assessment
src/components/dashboard.tsx   War-room UI
test/                          Deterministic unit tests
e2e/                           Playwright judge golden path
```

## Local development

Requirements: Node.js 22 and npm 10+.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

Keep `NEXT_PUBLIC_API_MODE=local`. No AWS or CockroachDB credential is needed. The deterministic local path mirrors the state machine and is intended for UI review, development, and CI—not as evidence that cloud integrations ran.

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
- A CockroachDB Basic cluster and separate admin/runtime SQL credentials.
- A read-only, cluster-scoped MCP service-account API key.

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
2. Complete the steps in [`JUDGES.md`](JUDGES.md) three times.
3. Confirm `SHOW INDEXES FROM memories` contains `memories_embedding_idx`.
4. Expand the UI trace and confirm `mcp.select_query` and `bedrock.converse` are successful.
5. Refresh after verification and confirm the learned postmortem persists.

## Security and failure behavior

- The site and evidence buckets are private; CloudFront uses Origin Access Control.
- Session cookies are HMAC-signed, `Secure`, `HttpOnly`, `SameSite=Lax`, and expire after 24 hours.
- Public input is limited to fixed demo commands and UUIDs. There is no upload or arbitrary SQL endpoint.
- Runtime database access is DML-only. MCP is read-only and uses a separate cluster-scoped key.
- Recall is limited to five calls per minute and 30 per sandbox per day; Lambda concurrency is capped at 5/2.
- Missing S3 evidence does not erase the incident; it is marked degraded.
- MCP failure uses a safe direct-read fallback and is visibly degraded.
- Bedrock failure returns retrieval-only evidence and creates no action.
- Logs contain trace ID, incident ID, stage, and latency—not secrets, raw prompts, or hidden reasoning.
- CloudWatch alarms cover API errors, worker errors, and API 5xx responses.

## Teardown

These commands delete cloud resources and data. Confirm the target account and cluster first:

```bash
npx cdk destroy
ccloud cluster delete recallops
```

## Submission checklist

- [ ] Public GitHub repository URL
- [ ] MIT license detected in GitHub About
- [ ] Functional CloudFront URL tested in incognito
- [ ] Redacted ccloud, MCP, vector-index, and AWS evidence committed
- [ ] Public YouTube/Vimeo video under 3 minutes
- [ ] Three consecutive production dry runs

See [`JUDGES.md`](JUDGES.md) for the two-minute judging path and explicit scoring-criteria mapping.
The production recording storyboard is in [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md).

## License

[MIT](LICENSE)
