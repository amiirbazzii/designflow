// packages/agents/src/ui-builder/ui-builder-agent.ts
//
// The UI Builder (Agent Architecture V2, AI role C).
//
// It writes code, and that is all it decides. Which component to reuse, what
// to create, where the screen lives and how foundations map were decided by
// the Project Mapper and arrive as immutable input; the Builder's judgment is
// how to express those decisions as correct code in this project's own idiom.
//
// It has no tools: no filesystem, no shell, no Figma, no approval. The files
// it may read were selected by the host from the map, and the files it may
// write are enumerated in the request — anything else is rejected
// deterministically before a person ever sees the proposal.
//
// `mode` is present from the start so V2-6 can add visual repair here rather
// than introducing a second code-writing agent: the Visual Correction agent
// exists today precisely because there was nowhere else to put that work.
import {
  agentManifestSchema,
  modelProfileSchema,
  proposedFileChangesSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type ModelProfile,
  type ProposedFileChanges,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { generateValidatedModelOutput } from "../model-structured-output";
import { builderProposalResponseSchema } from "./proposal-response-schema";
import type { BuilderEvidenceBundle } from "./builder-evidence-compiler";

const MODEL_PROFILE_ID = "ui-builder-default";

export const UI_BUILDER_AGENT_ID = "ui-builder-agent";
export const UI_BUILDER_AGENT_VERSION = "0.1.0";

export type UIBuilderMode = "initial" | "visual_repair";

export const uiBuilderAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: UI_BUILDER_AGENT_ID,
  name: "UI Builder",
  description: "Executes an approved Implementation Map as bounded code changes",
  version: UI_BUILDER_AGENT_VERSION,
  instructions:
    "You implement an already-decided plan. The design facts, the project " +
    "facts and the implementation decisions in this request were produced " +
    "deterministically and are not yours to revisit.\n\n" +
    "The decisions are binding:\n" +
    "- `reuse` means import and use that exact component. Do not modify it, " +
    "and do not create a variant of it.\n" +
    "- `extend` means change that exact component to support the stated " +
    "adaptation. Do not create a replacement beside it.\n" +
    "- `create` means write the planned file, and only that file.\n" +
    "- The destination and composition root are where the screen lives and " +
    "how it becomes reachable. A screen nobody can open is a failed build.\n" +
    "- A mapped token must be referenced; a value the plan kept raw must " +
    "appear as that exact value.\n\n" +
    "Write only to the paths listed in `constraints.allowedWritePaths`. Files " +
    "marked read-only are shown so you can import them correctly, never to be " +
    "edited. Match the project's own conventions — its import aliases, file " +
    "extensions, styling system and component idiom are in the request.\n\n" +
    "Preserve the design's exact visible copy verbatim. Every element the " +
    "Blueprint evidences must be implemented, not summarized.\n\n" +
    "If the plan genuinely cannot be executed — a mapped component is not what " +
    "the source shows, an adaptation is impossible within these files — say so " +
    "in `unexecutableReason` and return no files. Never quietly substitute a " +
    "different plan. Respond with structured output only.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-implementation"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const uiBuilderDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  // Its own profile, distinct from implementation-default, project-mapper-default
  // and design-interpreter-default, so an override for one never moves another.
  model: "openai/gpt-4o-mini",
  fallbackModels: ["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro"],
  // No raised timeout. Source generation is the largest V2 output, but the
  // work is bounded by the map: a handful of files for one screen.
});

/**
 * Output budget for one build.
 *
 * Measured on the fixtures rather than inherited from the legacy agent's
 * value. The Spendly-shaped screen — a page carrying every evidenced string,
 * an extended TextField and a created HistoryCard — serializes to 2,289 bytes
 * (~573 output tokens); a doubled multi-component page reaches ~1,101. 6000
 * is roughly 5× the measured worst case, which is the headroom real component
 * bodies need beyond a fixture, and still an order of magnitude below the
 * document-sized ceilings that produced the legacy truncation failures.
 */
export const MAX_BUILDER_OUTPUT_TOKENS = 6000;

export interface UIBuilderInput {
  readonly evidence: BuilderEvidenceBundle;
  readonly projectId: string;
  readonly baseProjectFingerprint: string;
  readonly attempt?: number;
}

/** A build that produced no proposal, with the reason typed rather than prose. */
export class ImplementationMapUnexecutableError extends Error {
  public readonly code = "ERR_IMPLEMENTATION_MAP_UNEXECUTABLE";
  public constructor(reason: string) {
    super(reason);
    this.name = "ImplementationMapUnexecutableError";
  }
}

export type UIBuilderStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<ProposedFileChanges>;

function readInput(request: AgentInvocationRequest): UIBuilderInput {
  const raw = request.input as Partial<UIBuilderInput> | undefined;
  if (
    raw?.evidence === undefined ||
    typeof raw.projectId !== "string" ||
    typeof raw.baseProjectFingerprint !== "string"
  ) {
    throw new SpecializedAgentOutputInvalidError(UI_BUILDER_AGENT_ID, [
      "input: a builder evidence bundle, projectId and baseProjectFingerprint are required",
    ]);
  }
  return raw as UIBuilderInput;
}

/** Strict-JSON providers express optional fields as null. */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, stripNulls(entry)]),
    );
  }
  return value;
}

/**
 * Normalizes the wire response into the existing proposal contract.
 *
 * The proposal a Builder produces is the same `ProposedFileChanges` every
 * safety gate already understands — path validation, proposed-state compile,
 * approval binding, apply. V2 adds provenance and nothing else.
 */
function toProposal(raw: unknown, input: UIBuilderInput, model?: string): ProposedFileChanges {
  const output = stripNulls(raw) as {
    files?: { path: string; action: "create" | "modify"; content: string; reason: string; relatedDesignNodeIds?: string[] }[];
    assumptions?: string[];
    unresolvedItems?: string[];
    unexecutableReason?: string;
  };

  if (output.unexecutableReason !== undefined && (output.files ?? []).length === 0) {
    throw new ImplementationMapUnexecutableError(output.unexecutableReason.slice(0, 400));
  }

  const parsed = proposedFileChangesSchema.safeParse({
    schemaVersion: "1",
    projectId: input.projectId,
    baseProjectFingerprint: input.baseProjectFingerprint,
    v2Binding: {
      builderAgentId: UI_BUILDER_AGENT_ID,
      builderAgentVersion: UI_BUILDER_AGENT_VERSION,
      builderModelProfileId: MODEL_PROFILE_ID,
      ...(model !== undefined ? { builderModel: model } : {}),
      attempt: input.attempt ?? 1,
      ...(input.evidence.constraints !== undefined &&
      typeof input.evidence.constraints === "object" &&
      (input.evidence.constraints as { projectFingerprint?: string }).projectFingerprint !== undefined
        ? { projectFingerprint: (input.evidence.constraints as { projectFingerprint?: string }).projectFingerprint }
        : {}),
    },
    files: (output.files ?? []).map((file) => ({
      path: file.path,
      action: file.action,
      content: file.content,
      reason: file.reason,
      relatedDesignNodeIds: file.relatedDesignNodeIds ?? [],
    })),
    packageChanges: [],
    commandsRequested: [],
    assumptions: output.assumptions ?? [],
    unresolvedItems: output.unresolvedItems ?? [],
  });

  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      UI_BUILDER_AGENT_ID,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return parsed.data;
}

/**
 * The offline strategy.
 *
 * Refuses rather than fabricating. Deterministic "code" would compile and
 * mean nothing, and a proposal that looks real is far worse than an honest
 * absence — the whole safety chain downstream assumes a proposal represents
 * an actual attempt to implement the design.
 */
export const deterministicUIBuilderStrategy: UIBuilderStrategy = async (request) => {
  readInput(request);
  throw new ImplementationMapUnexecutableError(
    "No builder model was available; DesignFlow does not generate placeholder implementations.",
  );
};

export const modelUIBuilderStrategy: UIBuilderStrategy = async (request, context, manifest) => {
  const input = readInput(request);

  return generateValidatedModelOutput({
    agentId: UI_BUILDER_AGENT_ID,
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Mode: ${input.evidence.mode}\n\n` +
          `Design requirements (authoritative):\n${JSON.stringify(input.evidence.design)}\n\n` +
          `Implementation decisions (immutable):\n${JSON.stringify(input.evidence.decisions)}\n\n` +
          `Project conventions:\n${JSON.stringify(input.evidence.project)}\n\n` +
          `Source you may read:\n${JSON.stringify(input.evidence.sources)}\n\n` +
          `Constraints:\n${JSON.stringify(input.evidence.constraints)}` +
          (input.evidence.visualRepair !== undefined
            ? `\n\nVisual repair. Your previous implementation was rendered and measured against the design. ` +
              `The plan above is unchanged and remains binding — same components, same destinations, same decisions. ` +
              `Emit the next complete proposal against the original project base (nothing has been applied), ` +
              `fixing exactly these measured visual mismatches within the allowed targets:\n` +
              `${JSON.stringify(input.evidence.visualRepair)}`
            : "") +
          (input.evidence.repair !== undefined
            ? `\n\nYour previous attempt failed deterministic validation. The plan above is unchanged and remains binding — fix the implementation:\n${JSON.stringify(input.evidence.repair)}`
            : ""),
      },
    ],
    responseSchema: builderProposalResponseSchema,
    maxOutputTokens: MAX_BUILDER_OUTPUT_TOKENS,
    validate: (output) => toProposal(output, input),
  });
};

class UIBuilderAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: UIBuilderStrategy;

  public constructor(manifest: AgentManifest, strategy: UIBuilderStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(request: AgentInvocationRequest, context: SpecializedAgentContext): Promise<ProposedFileChanges> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createUIBuilderAgent(strategy: UIBuilderStrategy = deterministicUIBuilderStrategy): SpecializedAgent {
  return new UIBuilderAgent(uiBuilderAgentManifest, strategy);
}

export const uiBuilderAgent: SpecializedAgent = createUIBuilderAgent();
