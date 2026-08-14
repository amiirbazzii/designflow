// packages/agents/src/visual-validation/visual-critic-agent.ts
//
// The Visual Critic (Agent Architecture V2, phase V2-5).
//
// It is handed findings that were already measured and asked one question:
// which of these would a person actually notice, and what probably caused it.
// It never sees a screenshot as its source of truth, never reports a
// measurement, and cannot add a finding — the merge refuses a patch that
// names a `findingId` the host did not mint.
//
// This is deliberately the opposite of the legacy visual-validation agent,
// which was asked to look at an image and describe what was wrong with it.
// That produced fluent, unverifiable claims; the field failures that started
// V2 included "findings" about elements that were never rendered.
import {
  agentManifestSchema,
  modelProfileSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
  type VisualCriticPatch,
  type VisualExpectation,
  type VisualFindingV1,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { generateValidatedModelOutput } from "../model-structured-output";
import { criticPatchResponseSchema } from "./critic-patch-response-schema";

const MODEL_PROFILE_ID = "visual-critic-default";

export const VISUAL_CRITIC_AGENT_ID = "visual-critic-agent";
export const VISUAL_CRITIC_AGENT_VERSION = "0.1.0";

/**
 * Output budget for one critic partition.
 *
 * An annotation is at most a severity, a priority and two short sentences,
 * and a partition carries at most 24 findings. Measured worst case is well
 * under 1,500 tokens; 2500 leaves room without inviting an essay.
 */
export const MAX_CRITIC_OUTPUT_TOKENS = 2500;

/** Findings per request. Small partitions keep every call far from truncation. */
export const MAX_FINDINGS_PER_PARTITION = 24;

export const visualCriticAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: VISUAL_CRITIC_AGENT_ID,
  name: "Visual Critic",
  description: "Interprets deterministic visual findings; never measures and never invents",
  version: VISUAL_CRITIC_AGENT_VERSION,
  instructions:
    "Every finding in this request was measured from a real browser render of " +
    "the proposed implementation. The measurements are correct and are not " +
    "yours to revise.\n\n" +
    "Your job is judgment the measurement cannot supply:\n" +
    "- Would a person using this screen notice this difference?\n" +
    "- Which findings matter most, relative to each other?\n" +
    "- What kind of change most likely causes it?\n\n" +
    "Annotate only the `findingId` values given to you. You cannot report a " +
    "new problem: if you believe something is wrong that no finding covers, " +
    "say so in `summary` and nothing else will act on it. Never restate an " +
    "expected or actual value, a size, a color or a position — those fields " +
    "do not exist in your response and a response containing them is " +
    "discarded whole.\n\n" +
    "Raise `severity` only when a measured difference is clearly worse than " +
    "its assigned severity for a real user. Never lower one. If you cannot " +
    "judge a finding from what you were given, list it in `inconclusive` " +
    "rather than guessing. Respond with structured output only.",
  allowedWorkflows: ["design-to-code-implementation"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const visualCriticDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  // Its own profile, so an override for the Builder or the Mapper never
  // silently moves the Critic.
  model: "openai/gpt-4o-mini",
  fallbackModels: ["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro"],
});

export interface CriticPartition {
  readonly partitionId: string;
  readonly findings: readonly VisualFindingV1[];
  readonly expectations: readonly VisualExpectation[];
}

/**
 * Splits findings into bounded partitions.
 *
 * Grouped by the design element they concern, so one request holds everything
 * about a single part of the screen — a critic asked about a heading's size
 * and its color together can say the heading is wrong once, instead of twice
 * with no idea they are the same element.
 */
export function partitionCriticFindings(
  findings: readonly VisualFindingV1[],
  expectations: readonly VisualExpectation[],
): readonly CriticPartition[] {
  if (findings.length === 0) return [];

  const byElement = new Map<string, VisualFindingV1[]>();
  for (const finding of findings) {
    const key = finding.evidenceReferences[0] ?? finding.findingId;
    const bucket = byElement.get(key);
    if (bucket === undefined) byElement.set(key, [finding]);
    else bucket.push(finding);
  }

  const partitions: CriticPartition[] = [];
  let current: VisualFindingV1[] = [];
  const flush = (): void => {
    if (current.length === 0) return;
    const ids = new Set(current.flatMap((finding) => finding.evidenceReferences));
    partitions.push({
      partitionId: `critic-partition-${partitions.length + 1}`,
      findings: current,
      expectations: expectations.filter((expectation) => ids.has(expectation.blueprintRef)),
    });
    current = [];
  };

  for (const group of byElement.values()) {
    if (current.length + group.length > MAX_FINDINGS_PER_PARTITION) flush();
    current.push(...group);
  }
  flush();
  return partitions;
}

/**
 * The bounded evidence one critic request carries.
 *
 * Everything the model needs to judge, and nothing it could mistake for a
 * source of measurement: no image bytes, no selectors, no file contents.
 */
export function compileCriticEvidence(partition: CriticPartition): {
  readonly partitionId: string;
  readonly findings: readonly {
    findingId: string;
    category: string;
    severity: string;
    element: string;
    expected?: string;
    actual?: string;
    delta?: number;
    measured: string;
  }[];
} {
  return {
    partitionId: partition.partitionId,
    findings: partition.findings.map((finding) => ({
      findingId: finding.findingId,
      category: finding.category,
      severity: finding.severity,
      element: finding.affectedComponent ?? "unnamed element",
      ...(finding.expectedValue !== undefined ? { expected: finding.expectedValue } : {}),
      ...(finding.actualValue !== undefined ? { actual: finding.actualValue } : {}),
      ...(finding.measurableDelta !== undefined ? { delta: finding.measurableDelta } : {}),
      measured: finding.explanation,
    })),
  };
}

/** Normalizes one wire response into the patch contract. */
export function toCriticPatch(raw: unknown, partitionId: string): VisualCriticPatch {
  const output = raw as {
    annotations?: readonly Record<string, unknown>[];
    summary?: string | null;
    inconclusive?: readonly { findingId?: string; reason?: string }[];
  };

  return {
    schemaVersion: "1",
    partitionId,
    annotations: (output.annotations ?? []).map((annotation) =>
      Object.fromEntries(Object.entries(annotation).filter(([, value]) => value !== null)),
    ) as VisualCriticPatch["annotations"],
    ...(typeof output.summary === "string" && output.summary.length > 0
      ? { summary: output.summary.slice(0, 600) }
      : {}),
    inconclusive: (output.inconclusive ?? []).filter(
      (entry): entry is { findingId: string; reason: string } =>
        typeof entry.findingId === "string" && typeof entry.reason === "string",
    ),
  };
}

// ── The Critic as an invocable specialized agent (V2-8) ─────────
//
// The evaluator's `critic` seam is a plain function; the production
// composition needs the model call behind it to live where every other V2
// role's does — a registered specialized agent invoked through the shared
// runtime, with the same tracing, budgets and profile resolution.

export type VisualCriticStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<VisualCriticPatch>;

function readCriticInput(request: AgentInvocationRequest): { evidence: unknown; partitionId: string } {
  const raw = request.input as { evidence?: unknown; partitionId?: unknown } | undefined;
  if (raw?.evidence === undefined || typeof raw.partitionId !== "string") {
    throw new SpecializedAgentOutputInvalidError(VISUAL_CRITIC_AGENT_ID, [
      "input: critic evidence and a partitionId are required",
    ]);
  }
  return { evidence: raw.evidence, partitionId: raw.partitionId };
}

/** Offline: the Critic is advisory, and an absent model is an absent Critic. */
export const deterministicVisualCriticStrategy: VisualCriticStrategy = async (request) => {
  readCriticInput(request);
  throw new SpecializedAgentOutputInvalidError(VISUAL_CRITIC_AGENT_ID, [
    "No critic model was available; deterministic evaluation proceeds without interpretation.",
  ]);
};

export const modelVisualCriticStrategy: VisualCriticStrategy = async (request, context, manifest) => {
  const { evidence, partitionId } = readCriticInput(request);

  return generateValidatedModelOutput({
    agentId: VISUAL_CRITIC_AGENT_ID,
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      { role: "user", content: `Measured findings (authoritative):\n${JSON.stringify(evidence)}` },
    ],
    responseSchema: criticPatchResponseSchema,
    maxOutputTokens: MAX_CRITIC_OUTPUT_TOKENS,
    validate: (output) => toCriticPatch(output, partitionId),
  });
};

class VisualCriticAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: VisualCriticStrategy;

  public constructor(manifest: AgentManifest, strategy: VisualCriticStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(request: AgentInvocationRequest, context: SpecializedAgentContext): Promise<VisualCriticPatch> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createVisualCriticAgent(
  strategy: VisualCriticStrategy = deterministicVisualCriticStrategy,
): SpecializedAgent {
  return new VisualCriticAgent(visualCriticAgentManifest, strategy);
}

export const visualCriticAgent: SpecializedAgent = createVisualCriticAgent();
