import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { mcpCredentials } from "./secrets";

const uuidSchema = z.string().uuid();

export async function inspectIncidentViaMcp(workspaceId: string, incidentId: string) {
  uuidSchema.parse(workspaceId);
  uuidSchema.parse(incidentId);
  if (process.env.USE_MOCK_SERVICES === "true") return { detail: "Mock MCP verified current action state", raw: "mock" };

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
    const sql = `SELECT id, title, status, risk FROM recallops.public.action_items WHERE workspace_id = '${workspaceId}' AND incident_id = '${incidentId}' LIMIT 25`;
    const args: Record<string, string> = {};
    const queryKey = ["query", "sql", "statement"].find((key) => key in properties) ?? "query";
    const databaseKey = ["database", "database_name", "db_name"].find((key) => key in properties);
    args[queryKey] = sql;
    if (databaseKey) args[databaseKey] = process.env.DATABASE_NAME ?? "recallops";
    const result = await client.callTool({ name: "select_query", arguments: args });
    const raw = JSON.stringify(result.content).slice(0, 2_000);
    return { detail: "Managed MCP verified current action state", raw };
  } finally {
    await client.close().catch(() => undefined);
  }
}
