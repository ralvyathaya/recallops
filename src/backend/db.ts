import pg, { type PoolClient, type QueryResultRow } from "pg";
import { databaseUrl } from "./secrets";

let pool: pg.Pool | undefined;

async function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: await databaseUrl(),
      application_name: "recallops",
      max: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return (await getPool()).query<T>(text, values);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await (await getPool()).connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "40001" || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt + Math.random() * 25));
    } finally {
      client.release();
    }
  }
  throw new Error("Transaction retry budget exhausted");
}

export const vectorLiteral = (values: number[]) => `[${values.join(",")}]`;
