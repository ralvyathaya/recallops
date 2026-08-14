import type { DashboardState } from "./types";

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

export function createScenario(workspaceId = crypto.randomUUID()): DashboardState {
  const now = new Date();
  const incidents = [
    {
      id: crypto.randomUUID(),
      externalRef: "INC-1042",
      service: "checkout-api",
      title: "Checkout saturation during flash sale",
      severity: "P1" as const,
      status: "resolved" as const,
      summary: "Database connection pool exhausted after leaked checkout sessions. Restart restored traffic, but the permanent leak guard was not shipped.",
      startedAt: hoursAgo(24 * 120),
      resolvedAt: hoursAgo(24 * 120 - 2),
    },
    {
      id: crypto.randomUUID(),
      externalRef: "INC-1178",
      service: "inventory-api",
      title: "Inventory upstream rate limiting",
      severity: "P2" as const,
      status: "resolved" as const,
      summary: "Vendor rate limits caused stale inventory reads. Exponential backoff and request coalescing resolved the incident.",
      startedAt: hoursAgo(24 * 70),
      resolvedAt: hoursAgo(24 * 70 - 1),
    },
    {
      id: crypto.randomUUID(),
      externalRef: "INC-1261",
      service: "checkout-api",
      title: "Checkout regression after deploy",
      severity: "P2" as const,
      status: "resolved" as const,
      summary: "A serialization regression increased CPU. Rolling back release 2026.06.18 restored normal latency.",
      startedAt: hoursAgo(24 * 40),
      resolvedAt: hoursAgo(24 * 40 - 1),
    },
  ];

  const memories = [
    {
      id: crypto.randomUUID(),
      incidentId: incidents[0].id,
      kind: "diagnosis" as const,
      service: "checkout-api",
      title: "Checkout database pool at 100% with acquire timeouts",
      content: "Checkout latency exceeded 8 seconds while the database connection pool stayed at 100% and acquire timeouts rose. Active connections were pinned at the pool maximum because checkout sessions missed release calls. Restart restored traffic but was mitigation only.",
      status: "verified" as const,
      confidence: 0.94,
      createdAt: incidents[0].resolvedAt!,
      lastVerifiedAt: incidents[0].resolvedAt,
    },
    {
      id: crypto.randomUUID(),
      incidentId: incidents[1].id,
      kind: "mitigation" as const,
      service: "inventory-api",
      title: "Upstream rate-limit recovery",
      content: "Apply exponential backoff and coalesce duplicate inventory requests when vendor 429 responses increase.",
      status: "verified" as const,
      confidence: 0.91,
      createdAt: incidents[1].resolvedAt!,
      lastVerifiedAt: incidents[1].resolvedAt,
    },
    {
      id: crypto.randomUUID(),
      incidentId: incidents[2].id,
      kind: "runbook" as const,
      service: "checkout-api",
      title: "Checkout rollback runbook",
      content: "Compare latency to the latest deployment and roll back only when the regression begins immediately after release.",
      status: "stale" as const,
      confidence: 0.62,
      createdAt: incidents[2].resolvedAt!,
      lastVerifiedAt: incidents[2].resolvedAt,
    },
  ];

  return {
    workspace: {
      id: workspaceId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    },
    incidents,
    memories,
    events: incidents.flatMap((incident) => [
      {
        id: crypto.randomUUID(),
        incidentId: incident.id,
        occurredAt: incident.startedAt,
        source: "system" as const,
        eventType: "incident_detected",
        message: `${incident.externalRef} detected for ${incident.service}`,
      },
      {
        id: crypto.randomUUID(),
        incidentId: incident.id,
        occurredAt: incident.resolvedAt!,
        source: "human" as const,
        eventType: "incident_resolved",
        message: incident.summary,
      },
    ]),
    actions: [
      {
        id: crypto.randomUUID(),
        incidentId: incidents[0].id,
        sourceMemoryId: memories[0].id,
        title: "Add connection leak detector and capacity guard",
        rationale: "The restart restored traffic but did not remove the leak that exhausted the pool.",
        risk: "low" as const,
        status: "approved" as const,
        owner: "Platform",
        dueAt: hoursAgo(-24 * 7),
        createdAt: incidents[0].resolvedAt!,
      },
    ],
  };
}

export const liveIncidentTemplate = {
  externalRef: "INC-2077",
  service: "checkout-api",
  title: "Checkout requests timing out",
  severity: "P1" as const,
  summary: "Checkout latency is above 8 seconds. Database pool is at 100%, acquire timeouts are rising, and deploy activity is unchanged.",
  logs: [
    "ERROR db.pool acquire timeout after 5000ms active=100 idle=0 max=100",
    "WARN checkout request latency_ms=8264 route=/orders",
    "INFO deployment current=2026.08.09-1 age_hours=19",
  ],
};
