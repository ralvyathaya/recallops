import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const cache = new Map<string, Record<string, string>>();

export async function secretJson(arn: string | undefined) {
  if (!arn) return {};
  const cached = cache.get(arn);
  if (cached) return cached;
  const result = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  const parsed = JSON.parse(result.SecretString ?? "{}") as Record<string, string>;
  cache.set(arn, parsed);
  return parsed;
}

export async function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const value = await secretJson(process.env.DATABASE_SECRET_ARN);
  if (!value.url || value.url === "replace-me") throw new Error("DATABASE_URL is not configured");
  return value.url;
}

export async function mcpCredentials() {
  if (process.env.MCP_API_KEY && process.env.MCP_CLUSTER_ID) {
    return { apiKey: process.env.MCP_API_KEY, clusterId: process.env.MCP_CLUSTER_ID };
  }
  const value = await secretJson(process.env.MCP_SECRET_ARN);
  if (!value.apiKey || !value.clusterId || value.apiKey === "replace-me") {
    throw new Error("CockroachDB MCP credentials are not configured");
  }
  return { apiKey: value.apiKey, clusterId: value.clusterId };
}

export async function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const value = await secretJson(process.env.SESSION_SECRET_ARN);
  if (!value.secret) throw new Error("Session secret is not configured");
  return value.secret;
}
