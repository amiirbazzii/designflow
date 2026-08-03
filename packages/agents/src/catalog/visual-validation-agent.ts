// packages/agents/src/catalog/visual-validation-agent.ts
import {
  agentManifestSchema,
  generatedImplementationSchema,
  modelProfileSchema,
  visualValidationReportSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type GeneratedImplementation,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
  type VisualValidationReport,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";

/**
 * The Visual Validation Agent.
 *
 * Compares a Figma source and a generated implementation and produces a
 * Visual Validation Report. In this stage there is no screenshot capture and
 * no image comparison — both strategies work from the same structural
 * signals already produced upstream (which files were proposed, whether any
 * are empty), not from pixels. Wiring in real screenshots and real image
 * comparison is explicitly the next stage's work; this stage only
 * establishes the validated contract and the invocation path.
 */

const MODEL_PROFILE_ID = "visual-validation-default";

export const visualValidationAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "visual-validation-agent",
  name: "Visual Validation Agent",
  description: "Evaluates a generated implementation against its design specification",
  version: "0.1.0",
  instructions:
    "Evaluate the supplied generated implementation for structural completeness " +
    "against the design it was generated from. Report an overall score, whether " +
    "it passes the configured threshold, and any discrepancy found, each with a " +
    "concrete recommendation. Never claim a screenshot was captured or compared " +
    "— none exists in this stage.",
  allowedWorkflows: ["design-to-code-agent-foundation"],
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
  const { generatedImplementation, threshold, attempt } = readInput(request);

  const result = await context.model.generate({
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
    responseSchema: { type: "object" },
    maxOutputTokens: 1000,
  });

  if (result.type === "failure") {
    throw new SpecializedAgentOutputInvalidError("visual-validation-agent", [
      `model call failed: ${result.code}`,
    ]);
  }

  return validate(manifest.version, {
    ...(typeof result.output === "object" && result.output !== null ? result.output : {}),
    validationAttempt: attempt,
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
