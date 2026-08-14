"use client";

import {
  Activity,
  ArchiveRestore,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Cloud,
  Database,
  FileCheck2,
  LoaderCircle,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clientApi, isCloudMode } from "@/lib/client-api";
import type { ActionItem, DashboardState, Memory } from "@/lib/types";

const time = (value: string) => new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", month: "short", day: "2-digit" }).format(new Date(value));
const percentage = (value?: number) => value == null ? "—" : `${Math.round(value * 100)}%`;

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}><span className="status-dot" />{children}</span>;
}

function SectionTitle({ eyebrow, title, accessory }: { eyebrow: string; title: string; accessory?: React.ReactNode }) {
  return <div className="section-title"><div><span>{eyebrow}</span><h2>{title}</h2></div>{accessory}</div>;
}

function MemoryCard({ memory, cited, sourceRef, openAction }: { memory: Memory; cited: boolean; sourceRef?: string; openAction?: ActionItem }) {
  return (
    <article className={`memory-card ${cited ? "cited" : ""}`}>
      <div className="memory-heading">
        <div>
          <span className={`memory-status ${memory.status}`}>{memory.status}</span>
          <h3>{memory.title}</h3>
        </div>
        {memory.score != null && <div className="memory-score"><strong>{percentage(memory.score)}</strong><span>relevance</span></div>}
      </div>
      <p>{memory.content}</p>
      {openAction && <div className="memory-followup"><ArchiveRestore size={14} /><span><small>Approved fix still incomplete</small><strong>{openAction.title}</strong></span></div>}
      <footer className="memory-footer">
        <div className="memory-meta">
          {sourceRef && <span className="source-ref">{sourceRef}</span>}
          <span>{memory.service}</span><span>{memory.kind}</span>
        </div>
        {cited && <div className="citation"><FileCheck2 size={13} /> Used in assessment</div>}
      </footer>
    </article>
  );
}

function ActionCard({ action, busy, sourceRef, onDecision, onComplete }: {
  action: ActionItem;
  busy: boolean;
  sourceRef?: string;
  onDecision: (decision: "approve" | "reject") => void;
  onComplete: () => void;
}) {
  return (
    <article className="action-card">
      <div className="action-heading">
        <span className={`action-status ${action.status}`}>{action.status.replace("_", " ")}</span>
        <span className={`risk ${action.risk}`}>{action.risk} risk</span>
      </div>
      <h3>{action.title}</h3>
      {sourceRef && <div className="action-source"><ArchiveRestore size={14} /> Recalled from unfinished action in {sourceRef}</div>}
      <p>{action.rationale}</p>
      <div className="action-footer">
        <span>Owner · {action.owner ?? "Unassigned"}</span>
        {action.status === "pending_approval" && <div className="button-row">
          <button className="button ghost danger" disabled={busy} onClick={() => onDecision("reject")}><X size={15} /> Reject</button>
          <button className="button primary" disabled={busy} onClick={() => onDecision("approve")}><ShieldCheck size={15} /> Approve</button>
        </div>}
        {action.status === "approved" && <button className="button primary" disabled={busy} onClick={onComplete}><Check size={15} /> Mark completed</button>}
        {action.status === "completed" && <span className="completion"><CheckCircle2 size={16} /> Evidence recorded</span>}
      </div>
    </article>
  );
}

export function Dashboard() {
  const [state, setState] = useState<DashboardState>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [traceOpen, setTraceOpen] = useState(true);

  useEffect(() => {
    clientApi.startSession().then(setState).catch((reason: Error) => setError(reason.message));
  }, []);

  const run = useCallback(async (label: string, operation: () => Promise<DashboardState>) => {
    setBusy(label);
    setError(undefined);
    try { setState(await operation()); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unexpected error"); }
    finally { setBusy(undefined); }
  }, []);

  const current = state?.incidents.find((incident) => incident.isCurrent) ?? state?.incidents.find((incident) => incident.status !== "resolved");
  const currentActions = useMemo(() => state?.actions.filter((action) => action.incidentId === current?.id) ?? [], [state, current]);
  const postmortem = state?.memories.find((memory) => memory.incidentId === current?.id && memory.kind === "postmortem");
  const cited = new Set(state?.assessment?.citations ?? []);
  const matchedMemories = state?.assessment?.memories ?? state?.memories
    .filter((memory) => memory.incidentId !== current?.id)
    .sort((left, right) => Number(state.actions.some((action) => action.sourceMemoryId === right.id && ["pending_approval", "approved"].includes(action.status)))
      - Number(state.actions.some((action) => action.sourceMemoryId === left.id && ["pending_approval", "approved"].includes(action.status))))
    .slice(0, 3) ?? [];
  const timeline = current ? state?.events.filter((event) => event.incidentId === current.id).slice(-8) ?? [] : [];
  const activeAction = currentActions.find((action) => ["pending_approval", "approved"].includes(action.status));
  const complete = currentActions.some((action) => action.status === "completed");
  const mcpTrace = state?.assessment?.toolTrace.find((entry) => entry.name === "mcp.select_query");
  const mcpDegraded = mcpTrace?.status === "degraded";
  const sourceRef = (memoryId?: string) => {
    const memory = state?.memories.find((item) => item.id === memoryId);
    return state?.incidents.find((incident) => incident.id === memory?.incidentId)?.externalRef;
  };
  const unfinishedAction = (memoryId: string) => state?.actions.find((action) =>
    action.sourceMemoryId === memoryId && ["pending_approval", "approved"].includes(action.status));

  let step = 1;
  if (current) step = 2;
  if (state?.assessment) step = 3;
  if (currentActions.some((action) => action.status === "approved")) step = 4;
  if (complete) step = 5;
  if (current?.status === "resolved") step = 6;
  if (postmortem?.status === "verified") step = 7;

  if (!state) return <main className="loading-screen"><LoaderCircle className="spin" /><p>Opening isolated incident sandbox…</p>{error && <span>{error}</span>}</main>;

  return (
    <main className={`shell ${current ? "has-incident" : ""}`}>
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-mark" src="/recallops-mark.svg" alt="RecallOps memory loop" width="36" height="36" />
          <div><strong>RecallOps</strong><span>Incident memory for reliability teams</span></div>
        </div>
        <div className="systems" aria-label="System status">
          <StatusPill tone="healthy"><Cloud size={13} /> AWS {isCloudMode ? "live" : "simulated"}</StatusPill>
          <StatusPill tone="healthy"><Database size={13} /> CockroachDB live</StatusPill>
          <StatusPill tone={mcpDegraded ? "warning" : mcpTrace?.status === "success" ? "healthy" : "neutral"}><Zap size={13} /> MCP {mcpDegraded ? "degraded" : mcpTrace?.status === "success" ? "verified" : "checks on recall"}</StatusPill>
        </div>
        <button className="reset" disabled={!!busy} onClick={() => run("reset", clientApi.reset)}><RefreshCcw size={15} /> Reset demo</button>
      </header>

      <section className={`hero ${current ? "compact" : ""}`}>
        <div>
          <div className="kicker"><span>LIVE INCIDENT SANDBOX</span><i /> Synthetic history <i /> Session {state.workspace.id.slice(0, 8)}</div>
          <h1>When incidents repeat, <em>memory closes the loop.</em></h1>
          <p>Recall verified operational history, catch unfinished fixes, and keep every production action behind human approval.</p>
          <div className="demo-disclosure"><Cloud size={15} /> Synthetic incident data · Real AWS + CockroachDB execution</div>
        </div>
        <div className="demo-progress" aria-label={`Demo step ${step} of 7`} aria-live="polite">
          <div className="progress-label"><span>Guided proof</span><strong>{step}/7</strong></div>
          <div className="progress-track"><span style={{ width: `${step / 7 * 100}%` }} /></div>
          <p>{step === 1 ? "Inject the recurring checkout incident" : step === 2 ? "Ask the agent to recall operational memory" : step === 3 ? "Review and approve the grounded proposal" : step === 4 ? "Record completion evidence" : step === 5 ? "Resolve and generate a postmortem" : step === 6 ? "Verify the new memory" : "Learning loop complete — refresh to prove persistence"}</p>
        </div>
      </section>

      {error && <div className="error-banner" role="alert"><TriangleAlert size={17} /><span>{error}</span><button onClick={() => setError(undefined)}>Dismiss</button></div>}

      <section className="incident-strip">
        <div className="incident-identity">
          <span className={current ? "severity p1" : "severity quiet"}>{current?.severity ?? "—"}</span>
          <div><span>{current ? current.externalRef : "NO ACTIVE INCIDENT"}</span><strong>{current?.title ?? "War room is standing by"}</strong></div>
        </div>
        <div className="incident-facts">
          <div><span>Service</span><strong>{current?.service ?? "—"}</strong></div>
          <div><span>Status</span><strong className={current ? `state-${current.status}` : ""}>{current?.status ?? "ready"}</strong></div>
          <div><span>Artifact</span><strong>{current?.artifactKey ? "S3 stored" : "—"}</strong></div>
        </div>
        {!current && <button className="button emergency" disabled={!!busy} onClick={() => run("trigger", clientApi.trigger)}>{busy === "trigger" ? <><LoaderCircle className="spin" size={17} /> Ingesting through CloudWatch…</> : <><Play size={17} /> Simulate incident</>}</button>}
        {current && !state.assessment && <button className="button recall" disabled={!!busy} onClick={() => run("recall", () => clientApi.recall(current.id))}>{busy === "recall" ? <><LoaderCircle className="spin" size={17} /> Searching CockroachDB memory…</> : <><Search size={17} /> Recall past incidents</>}</button>}
        {current && complete && current.status !== "resolved" && <button className="button resolve" disabled={!!busy} onClick={() => run("resolve", () => clientApi.resolve(current.id))}>{busy === "resolve" ? <LoaderCircle className="spin" size={17} /> : <ArchiveRestore size={17} />} Resolve incident</button>}
        {postmortem?.status === "proposed" && <button className="button resolve" disabled={!!busy} onClick={() => run("verify", () => clientApi.verify(postmortem.id))}>{busy === "verify" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Verify resolution</button>}
        {postmortem?.status === "verified" && <div className="loop-complete" role="status"><CheckCircle2 size={20} /><span>Memory verified<strong>Refresh-safe learning complete</strong></span></div>}
      </section>

      <section className="war-grid">
        <div className="panel timeline-panel">
          <SectionTitle eyebrow="Current incident" title="Activity timeline" accessory={<Activity size={18} />} />
          <div className="timeline">
            {timeline.length ? timeline.map((event) => <div className="timeline-row" key={event.id}>
              <div className={`timeline-icon ${event.source}`}>{event.source === "human" ? <ShieldCheck size={14} /> : event.source === "agent" ? <Activity size={14} /> : event.source === "cloudwatch" ? <CircleAlert size={14} /> : <Database size={14} />}</div>
              <div><div><strong>{event.eventType.replaceAll("_", " ")}</strong><time>{time(event.occurredAt)}</time></div><p>{event.eventType === "artifact_ingested" ? "Evidence stored in versioned S3" : event.message}</p><span>{event.source}</span></div>
            </div>) : <div className="empty"><Clock3 /><strong>No current incident</strong><p>Seeded history stays in memory. Simulate an incident to begin a new audit trail.</p></div>}
          </div>
        </div>

        <div className="panel evidence-panel">
          <SectionTitle eyebrow="Current evidence" title={current ? "Telemetry snapshot" : "Awaiting signal"} accessory={<span className="live-label"><i /> LIVE</span>} />
          {current ? <>
            <p className="incident-summary">{current.summary}</p>
            <div className="metrics">
              <div><span>Pool utilization</span><strong>100%</strong><i><b style={{ width: "100%" }} /></i></div>
              <div><span>Acquire timeout</span><strong>5,000ms</strong><i><b className="amber" style={{ width: "87%" }} /></i></div>
              <div><span>Deploy age</span><strong>19h</strong><i><b className="green" style={{ width: "34%" }} /></i></div>
            </div>
            <div className="log-box"><div><span /><span /><span /><strong>cloudwatch / checkout-api</strong></div>{liveLogs.map((log, index) => <code key={log}><i>{String(index + 1).padStart(2, "0")}</i>{log}</code>)}</div>
            {state.assessment && <div className="assessment">
              <div className="assessment-head">
                <div className="assessment-title"><Activity size={15} /><div><span>Recurrence assessment</span><strong>{state.assessment.matchStrength} evidence</strong></div></div>
                <div className="assessment-basis"><span>Evidence basis</span><strong>{state.assessment.citations.length} verified memory · MCP checked</strong></div>
              </div>
              <p>{state.assessment.summary}</p>
            </div>}
          </> : <div className="empty large explainer">
            <div><strong>Incident memory that closes unfinished work</strong><p>RecallOps helps reliability teams turn recurring incidents into verified operational memory.</p></div>
            <ol className="proof-flow" aria-label="How RecallOps works">
              <li><CircleAlert size={15} /><span><strong>Detect</strong>CloudWatch signal</span></li>
              <li><Search size={15} /><span><strong>Recall</strong>CockroachDB memory</span></li>
              <li><ShieldCheck size={15} /><span><strong>Approve</strong>Human decision</span></li>
              <li><Database size={15} /><span><strong>Learn</strong>Verified postmortem</span></li>
            </ol>
          </div>}
        </div>

        <div className="panel memory-panel">
          <SectionTitle eyebrow={state.assessment ? "CockroachDB memory" : "Seeded historical memory"} title={state.assessment ? "Relevant matches" : "Historical baseline"} accessory={<span className="candidate-count">{matchedMemories.length} {state.assessment ? "candidates" : "seeded records"}</span>} />
          <div className="memory-list">
            {postmortem && <article className={`learned-memory ${postmortem.status}`}>
              <div><span>{postmortem.status === "verified" ? <CheckCircle2 size={15} /> : <ArchiveRestore size={15} />} New learned memory</span><strong>{postmortem.status}</strong></div>
              <h3>{postmortem.title}</h3>
              <p>Postmortem stored in S3 and added to CockroachDB memory after human verification.</p>
              <span>Source {current?.externalRef}</span>
            </article>}
            {matchedMemories.map((memory) => <MemoryCard key={memory.id} memory={memory} cited={cited.has(memory.id)} sourceRef={sourceRef(memory.id)} openAction={unfinishedAction(memory.id)} />)}
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel actions-panel">
          <SectionTitle eyebrow="Human control plane" title="Approval-gated actions" accessory={activeAction ? <StatusPill tone="warning">Decision required</StatusPill> : undefined} />
          {currentActions.length ? currentActions.map((action) => <ActionCard key={action.id} action={action} busy={!!busy} sourceRef={sourceRef(action.sourceMemoryId)} onDecision={(decision) => run("decision", () => clientApi.decide(action.id, decision))} onComplete={() => run("complete", () => clientApi.complete(action.id))} />) : <div className="empty horizontal"><ShieldCheck /><div><strong>No production mutations</strong><p>One grounded proposal appears only after vector recall and MCP verification.</p></div></div>}
        </div>
        <div className="panel trace-panel">
          <button className="trace-toggle" onClick={() => setTraceOpen((open) => !open)} aria-expanded={traceOpen}><div><span>Observable by design</span><strong>Agent tool trace</strong></div><ChevronDown className={traceOpen ? "open" : ""} /></button>
          {traceOpen && <div className="trace-list">
            {state.assessment?.toolTrace.length ? state.assessment.toolTrace.map((entry, index) => {
              const hasPlan = entry.name === "vector_search" && entry.detail.includes(" · ");
              const summary = hasPlan ? entry.detail.split(" · ")[0] : entry.detail;
              return <div className="trace-row" key={`${entry.name}-${index}`}>
                <span className={`trace-check ${entry.status}`}>{entry.status === "success" ? <Check size={13} /> : <TriangleAlert size={13} />}</span>
                <div>
                  <div><strong>{entry.name}</strong><time>{entry.latencyMs}ms</time></div>
                  <p>{summary}</p>
                  {hasPlan && <details><summary>View query plan</summary><pre>{entry.detail}</pre></details>}
                </div>
              </div>;
            }) : <div className="empty"><Zap /><strong>Trace waiting</strong><p>Vector → MCP → Bedrock → transaction</p></div>}
          </div>}
        </div>
      </section>

      <footer><span><Database size={14} /> Public sandbox · synthetic history · expires in 24 hours</span><span>RecallOps · AWS us-east-1 · CockroachDB Cloud</span></footer>
    </main>
  );
}

const liveLogs = [
  "ERROR db.pool acquire timeout after 5000ms active=100 idle=0 max=100",
  "WARN  checkout request latency_ms=8264 route=/orders",
  "INFO  deployment current=2026.08.09-1 age_hours=19",
];
