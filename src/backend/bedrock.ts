import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import type { ActionItem, Memory } from "@/lib/types";

const region = process.env.AWS_REGION ?? "us-east-1";
const client = new BedrockRuntimeClient({ region });
const reasoningModel = process.env.BEDROCK_REASONING_MODEL ?? "global.amazon.nova-2-lite-v1:0";
const embeddingModel = process.env.BEDROCK_EMBEDDING_MODEL ?? "amazon.titan-embed-text-v2:0";

export const assessmentSchema = z.object({
  summary: z.string().min(20).max(1800),
  matchStrength: z.enum(["strong", "possible", "none"]),
  citations: z.array(z.string().uuid()).max(5),
  actions: z.array(
    z.object({
      title: z.string().min(8).max(240),
      rationale: z.string().min(12).max(1200),
      risk: z.enum(["low", "medium", "high"]),
      owner: z.string().min(2).max(80).default("Platform"),
    }),
  ).max(1),
});

export type AssessmentInput = z.infer<typeof assessmentSchema>;
export type HistoricalAction = Pick<ActionItem, "title" | "rationale" | "risk" | "owner">;

function deterministicEmbedding(text: string) {
  const values = Array.from({ length: 512 }, (_, index) => {
    let hash = 2166136261 ^ index;
    for (const char of text.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return ((hash >>> 0) / 0xffffffff) * 2 - 1;
  });
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / length);
}

export async function embedText(text: string) {
  if (process.env.USE_MOCK_SERVICES === "true") return deterministicEmbedding(text);
  const response = await client.send(new InvokeModelCommand({
    modelId: embeddingModel,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({ inputText: text.slice(0, 50_000), dimensions: 512, normalize: true }),
  }));
  const payload = JSON.parse(new TextDecoder().decode(response.body)) as { embedding?: number[] };
  if (!payload.embedding || payload.embedding.length !== 512) throw new Error("Bedrock returned an invalid embedding");
  return payload.embedding;
}

export function fallbackAssessment(memories: Memory[], openAction?: HistoricalAction): AssessmentInput {
  const best = memories.find((memory) => memory.status === "verified" && (memory.score ?? 0) >= 0.6);
  if (!best || !openAction) {
    return {
      summary: "No sufficiently trusted historical match was found. Continue diagnosis using current telemetry and preserve new evidence for future incidents.",
      matchStrength: "none",
      citations: [],
      actions: [],
    };
  }
  return {
    summary: `The current symptoms align with verified memory “${best.title}”. The earlier follow-up “${openAction.title}” is still incomplete.`,
    matchStrength: best.matchLabel === "strong" ? "strong" : "possible",
    citations: [best.id],
    actions: [{
      title: openAction.title,
      rationale: `${openAction.rationale} Verified memory “${best.title}” confirms the temporary mitigation did not close the loop.`,
      risk: openAction.risk,
      owner: openAction.owner ?? "Platform",
    }],
  };
}

export function groundAssessment(input: unknown, memories: Memory[], openAction?: HistoricalAction): AssessmentInput {
  const assessment = assessmentSchema.parse(input);
  const trusted = memories.some((memory) =>
    assessment.citations.includes(memory.id) && memory.status === "verified" && (memory.score ?? 0) >= 0.6);
  if (!trusted || !openAction) return { ...assessment, actions: [] };
  const proposal = assessment.actions[0];
  if (!proposal) throw new Error("Bedrock omitted the required grounded action");
  return {
    ...assessment,
    actions: [{
      ...proposal,
      title: openAction.title,
      risk: openAction.risk,
      owner: openAction.owner ?? "Platform",
    }],
  };
}

export async function createAssessment(incidentSummary: string, memories: Memory[], openAction?: HistoricalAction) {
  if (process.env.USE_MOCK_SERVICES === "true") return fallbackAssessment(memories, openAction);
  const prompt = [
    "You are RecallOps, a cautious SRE incident-memory agent.",
    "Use only the supplied memory evidence. Cite memory UUIDs exactly.",
    "Only verified memories with score >= 0.60 may justify an action.",
    "When a verified cited memory and an incomplete prior action are supplied, return exactly one action and copy the prior action title exactly.",
    "Otherwise return no actions. Actions are proposals for human approval, never claims of execution.",
    `Current incident: ${incidentSummary}`,
    `Historical memory: ${JSON.stringify(memories.map(({ id, title, content, status, score, matchLabel }) => ({ id, title, content, status, score, matchLabel })))}`,
    `Incomplete prior action: ${openAction ? JSON.stringify(openAction) : "none"}`,
  ].join("\n");
  const response = await client.send(new ConverseCommand({
    modelId: reasoningModel,
    system: [{ text: "Return the final assessment by calling record_assessment. Never expose hidden reasoning." }],
    messages: [{ role: "user", content: [{ text: prompt }] }],
    inferenceConfig: { temperature: 0, maxTokens: 2_000 },
    toolConfig: {
      tools: [{
        toolSpec: {
          name: "record_assessment",
          description: "Record a grounded incident assessment and safe action proposals.",
          inputSchema: {
            json: {
              type: "object",
              properties: {
                summary: { type: "string" },
                matchStrength: { type: "string", enum: ["strong", "possible", "none"] },
                citations: { type: "array", items: { type: "string" } },
                actions: {
                  type: "array",
                  maxItems: 1,
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      rationale: { type: "string" },
                      risk: { type: "string", enum: ["low", "medium", "high"] },
                      owner: { type: "string" },
                    },
                    required: ["title", "rationale", "risk", "owner"],
                  },
                },
              },
              required: ["summary", "matchStrength", "citations", "actions"],
            },
          },
        },
      }],
      toolChoice: { tool: { name: "record_assessment" } },
    },
  }));
  const blocks = response.output?.message?.content ?? [];
  const input = blocks.find((block) => block.toolUse?.name === "record_assessment")?.toolUse?.input;
  return groundAssessment(input, memories, openAction);
}

export const bedrockModels = { reasoningModel, embeddingModel };
