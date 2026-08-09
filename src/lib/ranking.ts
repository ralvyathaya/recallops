import type { Memory } from "./types";

export interface RankedCandidate extends Memory {
  similarity: number;
  score: number;
  matchLabel: "strong" | "possible" | "weak";
}

export function rerankMemories(
  candidates: Array<Memory & { similarity: number }>,
  service: string,
  now = Date.now(),
): RankedCandidate[] {
  return candidates
    .map((memory) => {
      const ageDays = Math.max(0, (now - new Date(memory.createdAt).getTime()) / 86_400_000);
      const recency = Math.max(0, 1 - ageDays / 365);
      const score =
        0.7 * memory.similarity +
        0.15 * Number(memory.service === service) +
        0.1 * Number(memory.status === "verified") +
        0.05 * recency;
      const rounded = Math.max(0, Math.min(1, Number(score.toFixed(4))));
      return {
        ...memory,
        score: rounded,
        matchLabel: rounded >= 0.75 ? "strong" : rounded >= 0.6 ? "possible" : "weak",
      } satisfies RankedCandidate;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
