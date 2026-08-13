// packages/agents/src/catalog/visual-validation-agent.ts
import {
  agentManifestSchema,
  generatedImplementationSchema,
  modelProfileSchema,
  visualValidationReportSchema,
  visualValidationAgentOutputV1Schema,
  visualValidationInputV1Schema,
  visualFindingV1Schema,
  type AgentInvocationRequest,
  type AgentManifest,
  type GeneratedImplementation,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
  type VisualValidationReport,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { visualValidationReportResponseSchema, visualValidationResponseSchema } from "../model-response-schemas";
import { generateValidatedModelOutput } from "../model-structured-output";

/**
 * The Visual Validation Agent.
 *
 * Compares a Figma source and a generated implementation and produces a
 * Visual Validation Report. The original structural-only invocation remains
 * compatible with the Stage 2 foundation workflow. Stage 5 adds a versioned
 * input boundary whose findings are evidence-bound before this agent sees them.
 */

const MODEL_PROFILE_ID = "visual-validation-default";

export const visualValidationAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "visual-validation-agent",
  name: "Visual Validation Agent",
  description: "Evaluates a generated implementation against its design specification",
  version: "0.1.0",
  instructions:
    "Interpret only supplied deterministic visual evidence. Every finding must " +
    "reference supplied evidence ids. Never invent screenshots, measurements, " +
    "URLs, or project changes.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-implementation"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const visualValidationDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

interface VisualValidationInput {
  readonly generatedImplementation: GeneratedImplementation;
  readonly threshold: number;
  readonly attempt: number;
}

export type VisualValidationStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<VisualValidationReport>;

function readStage5Input(request: AgentInvocationRequest): { input: ReturnType<typeof visualValidationInputV1Schema.parse>; findings: ReturnType<typeof visualFindingV1Schema.parse>[]; evidenceIds: Set<string> } | undefined {
  const raw = request.input as Record<string, unknown> | undefined;
  if (raw?.visualValidationInput === undefined) return undefined;
  const input = visualValidationInputV1Schema.safeParse(raw.visualValidationInput);
  if (!input.success) throw new SpecializedAgentOutputInvalidError("visual-validation-agent", input.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  const rawFindings = Array.isArray(raw.deterministicFindings) ? raw.deterministicFindings : [];
  const findings = rawFindings.map((finding, index) => {
    const parsed = visualFindingV1Schema.safeParse(finding);
    if (!parsed.success) throw new SpecializedAgentOutputInvalidError("visual-validation-agent", [`deterministicFindings[${index}] is invalid`]);
    return parsed.data;
  });
  const evidenceIds = new Set(Array.isArray(raw.evidenceIds) ? raw.evidenceIds.filter((id): id is string => typeof id === "string") : []);
  for (const finding of findings) for (const evidenceId of finding.evidenceReferences) if (!evidenceIds.has(evidenceId) && !evidenceId.startsWith("specification:")) throw new SpecializedAgentOutputInvalidError("visual-validation-agent", [`finding ${finding.findingId} references unknown evidence ${evidenceId}`]);
  return { input: input.data, findings, evidenceIds };
}

function readInput(request: AgentInvocationRequest): VisualValidationInput {
  const raw = request.input as Partial<VisualValidationInput> | undefined;
  const implementation = generatedImplementationSchema.safeParse(raw?.generatedImplementation);

  if (!implementation.success) {
    throw new SpecializedAgentOutputInvalidError("visual-validation-agent", [
      "input must carry a valid generatedImplementation",
    ]);
  }

  const threshold = typeof raw?.threshold === "number" ? raw.threshold : 0.8;
  const attempt = typeof raw?.attempt === "number" ? raw.attempt : request.attempt;

  return { generatedImplementation: implementation.data, threshold, attempt };
}

function validate(agentVersion: string, raw: unknown): VisualValidationReport {
  const withVersion =
    typeof raw === "object" && raw !== null ? { ...raw, agentVersion } : raw;
  const parsed = visualValidationReportSchema.safeParse(withVersion);

  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      "visual-validation-agent",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return parsed.data;
}

export const deterministicVisualValidationStrategy: VisualValidationStrategy = async (
  request,
  _context,
  manifest,
) => {
  const stage5 = readStage5Input(request);
  if (stage5 !== undefined) {
    return visualValidationAgentOutputV1Schema.parse({
      findings: stage5.findings,
      interpretation: stage5.findings.length === 0 ? "Deterministic checks found no material differences." : `Deterministic checks found ${stage5.findings.length} finding(s).`,
    }) as unknown as VisualValidationReport;
  }
  const { generatedImplementation, threshold, attempt } = readInput(request);

  const emptyFiles = generatedImplementation.files.filter(
    (file) => file.content.trim().length === 0,
  );

  const discrepancies = emptyFiles.map((file) => ({
    category: "completeness",
    severity: "high" as const,
    expected: `${file.path} contains implementation content`,
    actual: `${file.path} is empty`,
    recommendation: `Regenerate ${file.path} with real content.`,
  }));

  const fileCount = generatedImplementation.files.length;
  const overallScore = fileCount === 0 ? 0 : (fileCount - emptyFiles.length) / fileCount;

  return validate(manifest.version, {
    overallScore,
    threshold,
    passed: overallScore >= threshold,
    discrepancies,
    screenshotReferences: [],
    validationAttempt: attempt,
  });
};

export const modelVisualValidationStrategy: VisualValidationStrategy = async (
  request,
  context,
  manifest,
) => {
  const stage5 = readStage5Input(request);
  if (stage5 !== undefined) {
    return generateValidatedModelOutput({
      agentId: "visual-validation-agent",
      context,
      messages: [{ role: "system", content: manifest.instructions }, { role: "user", content: JSON.stringify({ input: stage5.input, deterministicFindings: stage5.findings }) }],
      responseSchema: visualValidationResponseSchema,
      maxOutputTokens: 1_000,
      validate: (output) => {
        const parsed = visualValidationAgentOutputV1Schema.parse(output);
        for (const finding of parsed.findings) for (const evidenceId of finding.evidenceReferences) if (!stage5.evidenceIds.has(evidenceId) && !evidenceId.startsWith("specification:")) throw new SpecializedAgentOutputInvalidError("visual-validation-agent", [`model finding ${finding.findingId} references unknown evidence ${evidenceId}`]);
        return visualValidationAgentOutputV1Schema.parse({ findings: [...stage5.findings, ...parsed.findings], interpretation: parsed.interpretation }) as unknown as VisualValidationReport;
      },
    });
  }
  const { generatedImplementation, threshold, attempt } = readInput(request);

  return generateValidatedModelOutput({
    agentId: "visual-validation-agent",
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Objective: ${request.objective}\n\n` +
          `Threshold: ${threshold}\n` +
          `Generated implementation:\n${JSON.stringify(generatedImplementation)}`,
      },
    ],
    responseSchema: visualValidationReportResponseSchema,
    maxOutputTokens: 1000,
    validate: (output) => validate(manifest.version, { ...(typeof output === "object" && output !== null ? output : {}), validationAttempt: attempt }),
  });
};

class VisualValidationAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: VisualValidationStrategy;

  public constructor(manifest: AgentManifest, strategy: VisualValidationStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(
    request: AgentInvocationRequest,
    context: SpecializedAgentContext,
  ): Promise<VisualValidationReport> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createVisualValidationAgent(
  strategy: VisualValidationStrategy = deterministicVisualValidationStrategy,
): SpecializedAgent {
  return new VisualValidationAgent(visualValidationAgentManifest, strategy);
}

export const visualValidationAgent: SpecializedAgent = createVisualValidationAgent();
