import { createHash } from "node:crypto";
import {
  agentManifestSchema,
  correctionAgentOutputV1Schema,
  correctionContextV1Schema,
  modelProfileSchema,
  VISUAL_CORRECTION_AGENT_ID,
  VISUAL_CORRECTION_AGENT_VERSION,
  type AgentInvocationRequest,
  type AgentManifest,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
  type CorrectionAgentOutputV1,
  type CorrectionContextV1,
} from "@designflow/sdk";
import { SpecializedAgentOutputInvalidError } from "../errors";
import { visualCorrectionResponseSchema } from "../model-response-schemas";
import { generateValidatedModelOutput } from "../model-structured-output";

const MODEL_PROFILE_ID = "visual-correction-default";

export const visualCorrectionAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: VISUAL_CORRECTION_AGENT_ID,
  name: "Visual Correction Agent",
  description: "Produces bounded, evidence-bound correction proposals without file or shell access",
  version: VISUAL_CORRECTION_AGENT_VERSION,
  instructions: "Propose only changes mapped to supplied finding and evidence ids. Never write files, run commands, invent evidence, approve a proposal, or claim validation success.",
  allowedWorkflows: ["design-to-code-feedback-loop"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow", stage: "6" },
});

export const visualCorrectionDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

export type VisualCorrectionStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<CorrectionAgentOutputV1>;

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function readContext(request: AgentInvocationRequest): CorrectionContextV1 {
  const raw = request.input as { correctionContext?: unknown } | undefined;
  const parsed = correctionContextV1Schema.safeParse(raw?.correctionContext ?? request.input);
  if (!parsed.success) throw new SpecializedAgentOutputInvalidError(VISUAL_CORRECTION_AGENT_ID, parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  return parsed.data;
}

function applyMeasuredReplacement(content: string, expected: string | undefined, actual: string | undefined): string | undefined {
  if (!expected || !actual || expected === actual || !content.includes(actual)) return undefined;
  const first = content.indexOf(actual);
  return `${content.slice(0, first)}${expected}${content.slice(first + actual.length)}`;
}

export const deterministicVisualCorrectionStrategy: VisualCorrectionStrategy = async (request, _context, manifest) => {
  const input = readContext(request);
  const changes: CorrectionAgentOutputV1["changes"] = [];
  const mappings: CorrectionAgentOutputV1["plan"]["findingToChangeMapping"] = [];

  for (const finding of input.selectedFindings) {
    const excerpt = input.currentImplementationExcerpts.find((candidate) => finding.affectedFiles.includes(candidate.path));
    if (!excerpt) throw new SpecializedAgentOutputInvalidError(VISUAL_CORRECTION_AGENT_ID, [`No supplied implementation excerpt covers finding ${finding.findingId}`]);
    const visualFinding = input.visualFindings.find((candidate) => candidate.findingId === finding.findingId);
    const expected = finding.expected ?? visualFinding?.expectedValue;
    const actual = finding.actual ?? visualFinding?.actualValue;
    const proposedContent = applyMeasuredReplacement(excerpt.content, expected, actual);
    if (proposedContent === undefined) throw new SpecializedAgentOutputInvalidError(VISUAL_CORRECTION_AGENT_ID, [`Finding ${finding.findingId} has no deterministic, bounded text correction in the supplied excerpt`]);
    const changeIndex = changes.length;
    changes.push({ schemaVersion: "1", operation: "modify", relativePath: excerpt.path, baseFileHash: excerpt.hash, proposedContentHash: hash(proposedContent), proposedContent, reason: `Address evidence-bound finding ${finding.findingId}.`, findingIds: [finding.findingId], evidenceIds: finding.evidenceReferences, expectedMeasurableOutcome: { expected: expected ?? "expected value", actual: actual ?? "actual value", ...(finding.measurableDelta !== undefined ? { delta: finding.measurableDelta } : {}) }, designSystemReferences: input.relevantDesignTokens.filter((token) => expected !== undefined && token.value === expected).map((token) => token.reference), dependencyChangeRequired: false });
    mappings.push({ findingId: finding.findingId, changeIndexes: [changeIndex], expectedOutcome: `Replace ${actual ?? "the measured actual value"} with ${expected ?? "the expected value"}.`, evidenceIds: finding.evidenceReferences });
  }

  return correctionAgentOutputV1Schema.parse({ schemaVersion: "1", plan: { schemaVersion: "1", iterationNumber: input.iterationNumber, objective: request.objective, selectedFindingIds: input.selectedFindings.map((finding) => finding.findingId), findingToChangeMapping: mappings, filesExpectedToChange: [...new Set(changes.map((change) => change.relativePath))], filesExpectedToRemainUnchanged: input.currentImplementationExcerpts.map((excerpt) => excerpt.path).filter((path) => !changes.some((change) => change.relativePath === path)), dependencyChanges: [], validationCommands: input.projectCommands.map((command) => `${command.executable} ${command.args.join(" ")}`), visualRevalidationRequirements: { required: true, viewports: input.projectCommands.length > 0 ? ["desktop", "tablet", "mobile"] : ["desktop", "tablet", "mobile"], invalidateOldScreenshots: true }, risks: ["The proposal changes only supplied excerpts and requires a fresh Stage 5 capture."], rollbackStatement: "Restore the one-per-iteration snapshot if application or required validation fails.", confidence: 1, limitations: ["The deterministic strategy proposes only literal measured replacements in supplied text excerpts."], agent: { id: VISUAL_CORRECTION_AGENT_ID, version: manifest.version, modelProfileId: manifest.modelProfileId ?? MODEL_PROFILE_ID }, evidenceReferences: [...new Set(changes.flatMap((change) => change.evidenceIds))] }, changes, traceIds: [`${VISUAL_CORRECTION_AGENT_ID}:${input.iterationNumber}`] });
};

export const modelVisualCorrectionStrategy: VisualCorrectionStrategy = async (request, context, manifest) => {
  const input = readContext(request);
  return generateValidatedModelOutput({
    agentId: VISUAL_CORRECTION_AGENT_ID,
    context,
    messages: [{ role: "system", content: manifest.instructions }, { role: "user", content: JSON.stringify({ objective: request.objective, correctionContext: input }) }],
    responseSchema: visualCorrectionResponseSchema,
    maxOutputTokens: 2_000,
    validate: (output) => {
      const parsed = correctionAgentOutputV1Schema.parse(output);
      for (const change of parsed.changes) {
        for (const findingId of change.findingIds) if (!input.selectedFindings.some((finding) => finding.findingId === findingId)) throw new SpecializedAgentOutputInvalidError(VISUAL_CORRECTION_AGENT_ID, [`unknown finding ${findingId}`]);
        for (const evidenceId of change.evidenceIds) if (!input.evidenceReferences.some((evidence) => evidence.artifactId === evidenceId)) throw new SpecializedAgentOutputInvalidError(VISUAL_CORRECTION_AGENT_ID, [`unknown evidence ${evidenceId}`]);
      }
      // Content-hash identities are deterministic facts, not model claims: a
      // model cannot compute sha256 of its own output, so the host derives
      // `proposedContentHash` from the model's proposed content and takes
      // `baseFileHash` from the trusted excerpt for the targeted path. A path
      // outside the supplied excerpts keeps the model's value and fails the
      // downstream scope/hash validation honestly.
      const changes = parsed.changes.map((change) => {
        const excerpt = input.currentImplementationExcerpts.find((candidate) => candidate.path === change.relativePath);
        return {
          ...change,
          ...(excerpt !== undefined ? { baseFileHash: excerpt.hash } : {}),
          ...(change.proposedContent !== undefined ? { proposedContentHash: hash(change.proposedContent) } : {}),
        };
      });
      return correctionAgentOutputV1Schema.parse({ ...parsed, changes, plan: { ...parsed.plan, agent: { ...parsed.plan.agent, id: VISUAL_CORRECTION_AGENT_ID, version: manifest.version, modelProfileId: manifest.modelProfileId ?? MODEL_PROFILE_ID } } });
    },
  });
};

class VisualCorrectionAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: VisualCorrectionStrategy;
  public constructor(manifest: AgentManifest, strategy: VisualCorrectionStrategy) { this.manifest = manifest; this.strategy = strategy; }
  public perform(request: AgentInvocationRequest, context: SpecializedAgentContext): Promise<CorrectionAgentOutputV1> { return this.strategy(request, context, this.manifest); }
}

export function createVisualCorrectionAgent(strategy: VisualCorrectionStrategy = deterministicVisualCorrectionStrategy): SpecializedAgent { return new VisualCorrectionAgent(visualCorrectionAgentManifest, strategy); }

export const visualCorrectionAgent: SpecializedAgent = createVisualCorrectionAgent();
