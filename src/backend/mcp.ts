import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { mcpCredentials } from "./secrets";
import type { HistoricalAction } from "./bedrock";

const uuidSchema = z.string().uuid();
const rowSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  status: z.enum(["pending_approval", "approved"]),
  risk: z.enum(["low", "medium", "high"]),
  rationale: z.string().min(1),
  owner: z.string().nullable().optional(),
});
const responseSchema = z.object({ rows: z.array(rowSchema) });

export function parseMcpAction(content: unknown): (HistoricalAction & { status: "pending_approval" | "approved" }) | undefined {
  const blocks = z.array(z.object({ type: z.literal("text"), text: z.string() })).parse(content);
  const rows = blocks.flatMap((block) => responseSchema.parse(JSON.parse(block.text)).rows);
  const action = rows[0];
  return action ? {
    title: action.title,
    rationale: action.rationale,
    risk: action.risk,
    owner: action.owner ?? undefined,
    status: action.status,
  } : undefined;
}

export async function inspectIncidentViaMcp(workspaceId: string, incidentId: string) {
  uuidSchema.parse(workspaceId);
  uuidSchema.parse(incidentId);
  if (process.env.USE_MOCK_SERVICES === "true") return {
    action: {
      title: "Add connection leak detector and capacity guard",
      rationale: "The restart restored traffic but did not remove the leak that exhausted the pool.",
      risk: "low" as const,
      owner: "Platform",
      status: "approved" as const,
    },
    detail: "MCP found approved incomplete action: Add connection leak detector and capacity guard",
  };

  const { apiKey, clusterId } = await mcpCredentials();
  const transport = new StreamableHTTPClientTransport(
    new URL(process.env.MCP_URL ?? "https://cockroachlabs.cloud/mcp"),
    { requestInit: { headers: { Authorization: `Bearer ${apiKey}`, "mcp-cluster-id": clusterId } } },
  );
  const client = new Client({ name: "recallops", version: "0.1.0" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const tool = tools.tools.find((candidate) => candidate.name === "select_query");
    if (!tool) throw new Error("CockroachDB MCP select_query tool is unavailable");
    const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
    const sql = `SELECT id, title, status, risk, rationale, owner FROM recallops.public.action_items WHERE workspace_id = '${workspaceId}' AND incident_id = '${incidentId}' AND status IN ('pending_approval','approved') ORDER BY created_at DESC LIMIT 1`;
    const args: Record<string, string> = {};
    const queryKey = ["query", "sql", "statement"].find((key) => key in properties) ?? "query";
    const databaseKey = ["database", "database_name", "db_name"].find((key) => key in properties);
    args[queryKey] = sql;
    if (databaseKey) args[databaseKey] = process.env.DATABASE_NAME ?? "recallops";
    const result = await client.callTool({ name: "select_query", arguments: args });
    const action = parseMcpAction(result.content);
    return {
      action,
      detail: action
        ? `MCP found ${action.status.replace("_", " ")} incomplete action: ${action.title}`
        : "MCP found no incomplete historical action",
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
