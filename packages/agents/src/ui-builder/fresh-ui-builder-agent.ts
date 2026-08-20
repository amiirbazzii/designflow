import {
  agentManifestSchema,
  modelProfileSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";
import { z } from "zod";
import { SpecializedAgentOutputInvalidError } from "../errors";
import { generateValidatedModelOutput } from "../model-structured-output";
import { builderProposalResponseSchema } from "./proposal-response-schema";

export const FRESH_UI_BUILDER_AGENT_ID = "fresh-ui-builder-agent";
export const FRESH_UI_BUILDER_AGENT_VERSION = "0.1.0";
const MODEL_PROFILE_ID = "ui-builder-default";

export const freshUiBuilderProposalSchema = z.object({
  files: z.array(z.object({
    path: z.string().min(1),
    action: z.enum(["create", "modify"]),
    content: z.string(),
    reason: z.string().min(1),
    relatedDesignNodeIds: z.array(z.string()).default([]),
  }).strict()),
  assumptions: z.array(z.string()),
  unresolvedItems: z.array(z.string()),
  unexecutableReason: z.string().nullable().optional(),
}).strict();

export type FreshUiBuilderProposal = z.infer<typeof freshUiBuilderProposalSchema>;

export interface FreshUiBuilderInput {
  /** A host-projected, authoritative FreshFrameEvidence object. */
  readonly evidence: unknown;
  readonly frame: {
    readonly id: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
  };
  readonly fixedStack: readonly ["Vite", "React", "TypeScript", "Plain CSS"];
  readonly allowedWritePaths: readonly string[];
  readonly currentFiles?: Readonly<Record<string, string>>;
  readonly buildFailure?: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode?: number;
  };
}

export type FreshUiBuilderStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<FreshUiBuilderProposal>;

export class FreshUiBuilderUnavailableError extends Error {
  public readonly code = "ERR_FRESH_UI_BUILDER_UNAVAILABLE";

  public constructor(message = "No Fresh UI Builder model is available.") {
    super(message);
    this.name = "FreshUiBuilderUnavailableError";
    Object.setPrototypeOf(this, FreshUiBuilderUnavailableError.prototype);
  }
}

export const freshUiBuilderAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: FRESH_UI_BUILDER_AGENT_ID,
  name: "Fresh UI Builder",
  description: "Generates a bounded implementation proposal from authoritative Fresh Figma evidence",
  version: FRESH_UI_BUILDER_AGENT_VERSION,
  instructions:
    "Implement only the supplied Figma frame in the fixed Vite + React + TypeScript + Plain CSS stack. " +
    "The host owns the output directory, file writes, configuration, dependencies, and build. " +
    "Return structured JSON only. Write only the explicitly allowed relative source paths. " +
    "Do not request commands, package changes, project discovery, or existing-project context. " +
    "Preserve visible copy and use the authoritative dimensions, hierarchy, geometry, styles, typography, " +
    "assets, screenshot, provenance, and warnings supplied by the host. Keep the implementation simple and buildable.",
  allowedWorkflows: ["fresh-ui"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const freshUiBuilderDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

export const MAX_FRESH_UI_BUILDER_OUTPUT_TOKENS = 6000;

function readInput(request: AgentInvocationRequest): FreshUiBuilderInput {
  const raw = request.input as Partial<FreshUiBuilderInput> | undefined;
  if (
    raw?.evidence === undefined
    || raw.frame === undefined
    || typeof raw.frame.id !== "string"
    || typeof raw.frame.name !== "string"
    || !Number.isFinite(raw.frame.width)
    || !Number.isFinite(raw.frame.height)
    || !Array.isArray(raw.allowedWritePaths)
  ) {
    throw new SpecializedAgentOutputInvalidError(FRESH_UI_BUILDER_AGENT_ID, [
      "input: Fresh evidence, frame identity/dimensions, and allowed write paths are required",
    ]);
  }
  return raw as FreshUiBuilderInput;
}

const summarize = (input: FreshUiBuilderInput): string => JSON.stringify({
  frame: input.frame,
  fixedStack: input.fixedStack,
  allowedWritePaths: input.allowedWritePaths,
  evidence: input.evidence,
  ...(input.currentFiles === undefined ? {} : { currentFiles: input.currentFiles }),
  ...(input.buildFailure === undefined ? {} : { buildFailure: input.buildFailure }),
});

export const deterministicFreshUiBuilderStrategy: FreshUiBuilderStrategy = async (request) => {
  readInput(request);
  throw new FreshUiBuilderUnavailableError();
};

export const modelFreshUiBuilderStrategy: FreshUiBuilderStrategy = async (request, context, manifest) => {
  const input = readInput(request);
  return generateValidatedModelOutput({
    agentId: FRESH_UI_BUILDER_AGENT_ID,
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          "Fresh UI implementation request (authoritative host input):\n" + summarize(input) +
          "\n\nReturn only the proposal object matching the supplied schema. " +
          "During repair, replace only allowed implementation files and address the reported compiler failure.",
      },
    ],
    responseSchema: builderProposalResponseSchema,
    maxOutputTokens: MAX_FRESH_UI_BUILDER_OUTPUT_TOKENS,
    validate: (output) => {
      const parsed = freshUiBuilderProposalSchema.safeParse(output);
      if (!parsed.success) {
        throw new SpecializedAgentOutputInvalidError(
          FRESH_UI_BUILDER_AGENT_ID,
          parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
        );
      }
      return parsed.data;
    },
  });
};

class FreshUiBuilderAgent implements SpecializedAgent {
  public constructor(
    public readonly manifest: AgentManifest,
    private readonly strategy: FreshUiBuilderStrategy,
  ) {}

  public perform(request: AgentInvocationRequest, context: SpecializedAgentContext): Promise<FreshUiBuilderProposal> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createFreshUiBuilderAgent(
  strategy: FreshUiBuilderStrategy = deterministicFreshUiBuilderStrategy,
): SpecializedAgent {
  return new FreshUiBuilderAgent(freshUiBuilderAgentManifest, strategy);
}

export const freshUiBuilderAgent: SpecializedAgent = createFreshUiBuilderAgent();
