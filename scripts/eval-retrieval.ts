import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Incident } from "../src/lib/types";
import { embedText } from "../src/backend/bedrock";
import { query } from "../src/backend/db";
import { ensureWorkspace, retrieveMemories } from "../src/backend/repository";

interface Fixture {
  id: string;
  service: string;
  query: string;
  expectedTitle: string;
  core?: boolean;
}

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the CockroachDB retrieval evaluation");
if (process.env.USE_MOCK_SERVICES === "true") throw new Error("Use real Titan embeddings for the submission retrieval evaluation");

const fixtures = JSON.parse(await readFile(join(process.cwd(), "fixtures/retrieval-eval.json"), "utf8")) as Fixture[];
const workspaceId = crypto.randomUUID();

try {
  await ensureWorkspace(workspaceId);
  const results = [];
  for (const fixture of fixtures) {
    const incident: Incident = {
      id: crypto.randomUUID(),
      externalRef: `EVAL-${fixture.id}`,
      service: fixture.service,
      title: fixture.query,
      severity: "P2",
      status: "investigating",
      summary: fixture.query,
      startedAt: new Date().toISOString(),
    };
    const embedding = await embedText(fixture.query);
    const { matches } = await retrieveMemories(workspaceId, incident, embedding);
    const rank = matches.findIndex((memory) => memory.title === fixture.expectedTitle) + 1;
    results.push({ id: fixture.id, expected: fixture.expectedTitle, rank: rank || null, top: matches[0]?.title ?? null, passAt3: rank > 0 && rank <= 3, core: !!fixture.core });
  }
  const recallAt3 = results.filter((result) => result.passAt3).length / results.length;
  const coreTop1 = results.filter((result) => result.core).every((result) => result.rank === 1);
  console.log(JSON.stringify({ fixtureCount: results.length, recallAt3, coreTop1, results }, null, 2));
  if (recallAt3 < 0.8 || !coreTop1) process.exitCode = 1;
} finally {
  await query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
}
