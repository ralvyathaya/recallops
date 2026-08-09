import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running db:init");
const sql = await readFile(path.join(process.cwd(), "db", "init.sql"), "utf8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(sql);
  console.log("RecallOps schema is ready.");
} finally {
  await client.end();
}
