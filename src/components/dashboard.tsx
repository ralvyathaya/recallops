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
  Fingerprint,
  LoaderCircle,
  Play,
  RefreshCcw,
  Search,
  ShieldCheck,
  Sparkles,
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

function MemoryCard({ memory, cited }: { memory: Memory; cited: boolean }) {
  return (
    <article className={`memory-card ${cited ? "cited" : ""}`}>
      <div className="memory-top">
        <span className={`memory-status ${memory.status}`}>{memory.status}</span>
        {memory.score != null && <strong>{percentage(memory.score)} match</strong>}
      </div>
      <h3>{memory.title}</h3>
      <p>{memory.content}</p>
      <div className="memory-meta">
        <span>{memory.service}</span><span>{memory.kind}</span>
        {memory.matchLabel && <span className={`match-${memory.matchLabel}`}>{memory.matchLabel}</span>}
      </div>
      {cited && <div className="citation"><FileCheck2 size={14} /> Evidence cited by assessment</div>}
    </article>
  );
}

function ActionCard({ action, busy, onDecision, onComplete }: {
  action: ActionItem;
  busy: boolean;
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
  const matchedMemories = state?.assessment?.memories ?? state?.memories.filter((memory) => memory.incidentId !== current?.id).slice(0, 3) ?? [];
  const timeline = state?.events.filter((event) => current ? event.incidentId === current.id : true).slice(-8) ?? [];
  const activeAction = currentActions.find((action) => ["pending_approval", "approved"].includes(action.status));
  const complete = currentActions.some((action) => action.status === "completed");

  let step = 1;
  if (current) step = 2;
  if (state?.assessment) step = 3;
  if (currentActions.some((action) => action.status === "approved")) step = 4;
  if (complete) step = 5;
  if (current?.status === "resolved") step = 6;
  if (postmortem?.status === "verified") step = 7;

  if (!state) return <main className="loading-screen"><LoaderCircle className="spin" /><p>Opening isolated incident sandbox…</p>{error && <span>{error}</span>}</main>;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Fingerprint size={20} /></div><div><strong>RecallOps</strong><span>Incident memory war room</span></div></div>
        <div className="systems" aria-label="System status">
          <StatusPill tone="healthy"><Cloud size={13} /> AWS {isCloudMode ? "live" : "simulated"}</StatusPill>
          <StatusPill tone="healthy"><Database size={13} /> Cockroach persistent</StatusPill>
          <StatusPill tone={state.assessment?.degraded.includes("mcp") ? "warning" : "healthy"}><Zap size={13} /> MCP {state.assessment?.degraded.includes("mcp") ? "degraded" : "ready"}</StatusPill>
        </div>
        <button className="reset" disabled={!!busy} onClick={() => run("reset", clientApi.reset)}><RefreshCcw size={15} /> Reset demo</button>
      </header>

      <section className="hero">
        <div>
          <div className="kicker"><span>LIVE SANDBOX</span><i /> Session {state.workspace.id.slice(0, 8)}</div>
          <h1>When incidents repeat,<br /><em>memory closes the loop.</em></h1>
          <p>Recall verified operational history, catch unfinished fixes, and keep every production action behind human approval.</p>
        </div>
        <div className="demo-progress" aria-label={`Demo step ${step} of 7`}>
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
        {!current && <button className="button emergency" disabled={!!busy} onClick={() => run("trigger", clientApi.trigger)}>{busy === "trigger" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />} Simulate incident</button>}
        {current && !state.assessment && <button className="button recall" disabled={!!busy} onClick={() => run("recall", () => clientApi.recall(current.id))}>{busy === "recall" ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} Recall past incidents</button>}
        {current && complete && current.status !== "resolved" && <button className="button resolve" disabled={!!busy} onClick={() => run("resolve", () => clientApi.resolve(current.id))}>{busy === "resolve" ? <LoaderCircle className="spin" size={17} /> : <ArchiveRestore size={17} />} Resolve incident</button>}
        {postmortem?.status === "proposed" && <button className="button resolve" disabled={!!busy} onClick={() => run("verify", () => clientApi.verify(postmortem.id))}>{busy === "verify" ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} Verify resolution</button>}
        {postmortem?.status === "verified" && <div className="loop-complete"><CheckCircle2 size={20} /><span>Memory verified<strong>Refresh-safe learning complete</strong></span></div>}
      </section>

      <section className="war-grid">
        <div className="panel timeline-panel">
          <SectionTitle eyebrow="Append-only audit" title="Incident timeline" accessory={<Activity size={18} />} />
          <div className="timeline">
            {timeline.length ? timeline.map((event) => <div className="timeline-row" key={event.id}>
              <div className={`timeline-icon ${event.source}`}>{event.source === "human" ? <ShieldCheck size={14} /> : event.source === "agent" ? <Sparkles size={14} /> : event.source === "cloudwatch" ? <CircleAlert size={14} /> : <Database size={14} />}</div>
              <div><div><strong>{event.eventType.replaceAll("_", " ")}</strong><time>{time(event.occurredAt)}</time></div><p>{event.message}</p><span>{event.source}</span></div>
            </div>) : <div className="empty"><Clock3 /><strong>No active timeline</strong><p>Simulate an incident to start the evidence trail.</p></div>}
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
            {state.assessment && <div className="assessment"><div><Sparkles size={17} /><strong>Agent assessment</strong><span>{state.assessment.matchStrength} match</span></div><p>{state.assessment.summary}</p></div>}
          </> : <div className="empty large"><Activity /><strong>Healthy baseline</strong><p>The synthetic P1 will enter through CloudWatch and preserve its raw artifact in S3.</p></div>}
        </div>

        <div className="panel memory-panel">
          <SectionTitle eyebrow="CockroachDB memory" title="Relevant matches" accessory={<span className="candidate-count">{matchedMemories.length} candidates</span>} />
          <div className="memory-list">
            {matchedMemories.map((memory) => <MemoryCard key={memory.id} memory={memory} cited={cited.has(memory.id)} />)}
          </div>
        </div>
      </section>

      <section className="lower-grid">
        <div className="panel actions-panel">
          <SectionTitle eyebrow="Human control plane" title="Approval-gated actions" accessory={activeAction ? <StatusPill tone="warning">Decision required</StatusPill> : undefined} />
          {currentActions.length ? currentActions.map((action) => <ActionCard key={action.id} action={action} busy={!!busy} onDecision={(decision) => run("decision", () => clientApi.decide(action.id, decision))} onComplete={() => run("complete", () => clientApi.complete(action.id))} />) : <div className="empty horizontal"><ShieldCheck /><div><strong>No production mutations</strong><p>Grounded proposals appear here only after vector recall and MCP verification.</p></div></div>}
        </div>
        <div className="panel trace-panel">
          <button className="trace-toggle" onClick={() => setTraceOpen((open) => !open)} aria-expanded={traceOpen}><div><span>Observable by design</span><strong>Agent tool trace</strong></div><ChevronDown className={traceOpen ? "open" : ""} /></button>
          {traceOpen && <div className="trace-list">
            {state.assessment?.toolTrace.length ? state.assessment.toolTrace.map((entry, index) => <div className="trace-row" key={`${entry.name}-${index}`}>
              <span className={`trace-check ${entry.status}`}>{entry.status === "success" ? <Check size={13} /> : <TriangleAlert size={13} />}</span>
              <div><div><strong>{entry.name}</strong><time>{entry.latencyMs}ms</time></div><p>{entry.detail}</p></div>
            </div>) : <div className="empty"><Zap /><strong>Trace waiting</strong><p>Vector → MCP → Bedrock → transaction</p></div>}
          </div>}
        </div>
      </section>

      <footer><span><Database size={14} /> Memory expires with this sandbox in 24 hours</span><span>RecallOps · AWS us-east-1 · CockroachDB Cloud</span></footer>
    </main>
  );
}

const liveLogs = [
  "ERROR db.pool acquire timeout after 5000ms active=100 idle=0 max=100",
  "WARN  checkout request latency_ms=8264 route=/orders",
  "INFO  deployment current=2026.08.09-1 age_hours=19",
];
