// packages/agents/src/project-mapper/project-mapper-agent.ts
//
// The Project Mapper (Agent Architecture V2, AI role B).
//
// It answers one question per bounded partition: given this design
// requirement and these existing project components, should the
// implementation reuse, extend or create — and where does the screen become
// reachable?
//
// It has no tools, so it cannot read the filesystem, run a command or call
// Figma. Its only project knowledge is the compiled ProjectContext evidence
// it is handed, and its only way to name a project component is to select an
// id the host minted. It cannot write code: the patch contract has no field
// for one.
import {
  agentManifestSchema,
  mappingPatchSchema,
  modelProfileSchema,
  MAPPING_PATCH_SCHEMA_VERSION,
  type AgentInvocationRequest,
  type AgentManifest,
  type MappingPatch,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { generateValidatedModelOutput } from "../model-structured-output";
import { mappingPatchResponseSchema } from "./mapping-patch-response-schema";
import type { MappingEvidenceBundle } from "./evidence-compiler";

const MODEL_PROFILE_ID = "project-mapper-default";

export const PROJECT_MAPPER_AGENT_ID = "project-mapper-agent";
export const PROJECT_MAPPER_AGENT_VERSION = "0.1.0";

export const projectMapperAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: PROJECT_MAPPER_AGENT_ID,
  name: "Project Mapper",
  description: "Decides how a design requirement is realized inside a specific project",
  version: PROJECT_MAPPER_AGENT_VERSION,
  instructions:
    "You decide how an already-compiled design is realized inside an " +
    "already-inspected project. Both are facts: the design requirements and " +
    "the project's components, destinations and tokens were compiled " +
    "deterministically and are not yours to restate, correct or extend.\n\n" +
    "For each requirement you are asked to decide:\n" +
    "- `reuse` when an offered component satisfies the requirement without " +
    "changing its public contract.\n" +
    "- `extend` when an offered component is the right architectural base but " +
    "needs bounded additions — a variant, a slot, a state.\n" +
    "- `create` when no offered component should be reused. Never choose " +
    "`create` because you are unsure what the project contains: the offered " +
    "candidates are the project's components, and an empty candidate list " +
    "means there genuinely is nothing to reuse.\n\n" +
    "Prefer, in order: a compatible design-system component, a compatible " +
    "project component, a bounded extension, a new component. Compatibility " +
    "outranks reuse — do not force reuse that violates the design's structure " +
    "or visual requirements.\n\n" +
    "Judge compatibility along each named dimension (structure, slots, states, " +
    "visual, interaction) rather than in prose, and give a short reason. A " +
    "component reused for six different uses must be able to express all six; " +
    "if one instance needs a slot the component lacks, that is `extend`.\n\n" +
    "For the destination, choose how the screen becomes reachable from the " +
    "offered candidates — a screen whose components exist but which nobody can " +
    "open is a failed implementation.\n\n" +
    "Select candidates, tokens, directories and destinations by their `id`. " +
    "Never write a path, a route, a token reference, a file name or any code: " +
    "the response contract has nowhere to put them, and a project fact you " +
    "invent will be rejected. Where you genuinely cannot decide, record a " +
    "specific uncertainty rather than guessing. Respond with structured " +
    "output only.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-figma-specification"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const projectMapperDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  // Its own profile id, deliberately separate from the Design Interpreter's,
  // so a per-agent override never crosses between two very different jobs.
  // No raised timeout — a partition that needed one would be a partition
  // that is too big.
  //
  // Single candidate, deliberately: `openai/gpt-5.6-luna` and
  // `deepseek/deepseek-v4-pro` are the same two fallback candidates
  // `figma-specification-default` already proved never resolve on the
  // managed gateway (field run d840ab80, ERR_MODEL_UNAVAILABLE upstream),
  // and V2-10 field evidence (executionId
  // 0506a14f-a052-4ff7-a0ce-95ad40126677) reconfirmed both as
  // ERR_MODEL_ROUTE_NOT_FOUND for this profile too. Removing them is not a
  // guess at a replacement, only removing two candidates already proven
  // dead. That same run showed the primary `openai/gpt-4o-mini` candidate
  // also failing with ERR_MODEL_ROUTE_NOT_FOUND for this profile id, unlike
  // the legacy `figma-specification-default` profile — root-causing that
  // gap is a managed-gateway route-configuration question outside this
  // repository, not something this profile's code can resolve.
  model: "openai/gpt-4o-mini",
});

/**
 * Output budget for one mapping patch.
 *
 * Measured against the Spendly fixture: the largest partition patch — six
 * component decisions with full compatibility, adaptations and reasons —
 * serializes well under 4 KB (~1k tokens). 2500 leaves roughly a 2× margin
 * and stays an order of magnitude below the document-sized ceilings that
 * produced the legacy truncation failures.
 */
export const MAX_MAPPING_PATCH_OUTPUT_TOKENS = 2500;

export type ProjectMapperStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<MappingPatch>;

function readEvidence(request: AgentInvocationRequest): MappingEvidenceBundle {
  const raw = (request.input as { evidence?: unknown } | undefined)?.evidence as MappingEvidenceBundle | undefined;
  if (raw === undefined || typeof raw.partitionId !== "string" || typeof raw.stage !== "string") {
    throw new SpecializedAgentOutputInvalidError(PROJECT_MAPPER_AGENT_ID, [
      "input.evidence: missing or does not match a mapping evidence bundle",
    ]);
  }
  return raw;
}

/** Rejects any decision outside what this partition was allowed to decide. */
function validateAgainstPartition(raw: unknown, evidence: MappingEvidenceBundle): MappingPatch {
  const decide = evidence.decide as { requirementIds?: string[]; candidateIds?: string[] } | undefined;
  const withIdentity =
    typeof raw === "object" && raw !== null
      ? { ...(raw as Record<string, unknown>), schemaVersion: MAPPING_PATCH_SCHEMA_VERSION, partitionId: evidence.partitionId }
      : raw;

  const parsed = mappingPatchSchema.safeParse(withIdentity);
  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      PROJECT_MAPPER_AGENT_ID,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const patch = parsed.data;
  const allowedRequirements = new Set(decide?.requirementIds ?? []);
  const allowedCandidates = new Set(decide?.candidateIds ?? []);
  const outside: string[] = [];

  for (const decision of patch.componentDecisions) {
    if (!allowedRequirements.has(decision.requirementId)) outside.push(decision.requirementId);
    if (decision.candidateId !== undefined && !allowedCandidates.has(decision.candidateId)) outside.push(decision.candidateId);
    if (decision.plannedDirectoryId !== undefined && !allowedCandidates.has(decision.plannedDirectoryId)) {
      // Planned directories are offered through the project evidence rather
      // than the decide list; accept them only when the evidence carried them.
      const directories = (evidence.project as { plannedDirectories?: { id: string }[] } | undefined)?.plannedDirectories ?? [];
      if (!directories.some((directory) => directory.id === decision.plannedDirectoryId)) {
        outside.push(decision.plannedDirectoryId);
      }
    }
  }
  if (patch.destinationDecision !== undefined) {
    if (!allowedRequirements.has(patch.destinationDecision.requirementId)) outside.push(patch.destinationDecision.requirementId);
    if (!allowedCandidates.has(patch.destinationDecision.candidateId)) outside.push(patch.destinationDecision.candidateId);
  }
  for (const decision of patch.styleDecisions) {
    if (decision.projectTokenId !== undefined && !allowedCandidates.has(decision.projectTokenId)) outside.push(decision.projectTokenId);
  }
  for (const decision of patch.assetDecisions) {
    if (!allowedRequirements.has(decision.requirementId)) outside.push(decision.requirementId);
    if (decision.projectAssetId !== undefined && !allowedCandidates.has(decision.projectAssetId)) outside.push(decision.projectAssetId);
  }

  if (outside.length > 0) {
    throw new SpecializedAgentOutputInvalidError(PROJECT_MAPPER_AGENT_ID, [
      `decisions reference ids outside this partition's allowed set: ${[...new Set(outside)].slice(0, 5).join(", ")}`,
    ]);
  }

  return patch;
}

/**
 * The offline strategy.
 *
 * Returns an empty patch with a stated uncertainty rather than inventing a
 * mapping. A deterministic "reuse whatever has the closest name" would be a
 * guess wearing the clothes of a decision — and the candidate scores it would
 * rest on are already in the draft for a person to read.
 */
export const deterministicProjectMapperStrategy: ProjectMapperStrategy = async (request) => {
  const evidence = readEvidence(request);
  return mappingPatchSchema.parse({
    schemaVersion: MAPPING_PATCH_SCHEMA_VERSION,
    partitionId: evidence.partitionId,
    uncertainties: [
      {
        code: "MAPPING_NOT_PERFORMED",
        description:
          "No mapper model was consulted for this partition; the draft keeps its requirements and candidates undecided.",
        requirementIds: [],
        requiresUserInput: false,
      },
    ],
  });
};

export const modelProjectMapperStrategy: ProjectMapperStrategy = async (request, context, manifest) => {
  const evidence = readEvidence(request);

  return generateValidatedModelOutput({
    agentId: PROJECT_MAPPER_AGENT_ID,
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Mapping partition: ${evidence.partitionId} (${evidence.stage})\n\n` +
          `Design requirements (authoritative):\n${JSON.stringify(evidence.design)}\n\n` +
          `Project facts (authoritative):\n${JSON.stringify(evidence.project)}\n\n` +
          `Decide exactly these:\n${JSON.stringify(evidence.decide)}`,
      },
    ],
    responseSchema: mappingPatchResponseSchema,
    maxOutputTokens: MAX_MAPPING_PATCH_OUTPUT_TOKENS,
    validate: (output) => validateAgainstPartition(stripNulls(dropInapplicableDestination(output)), evidence),
  });
};

/**
 * The wire contract answers "no destination decision here" with a null
 * `requirementId` (the portable schema subset forbids nullable objects);
 * the patch contract expresses the same thing by omission.
 */
function dropInapplicableDestination(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const destination = record["destinationDecision"] as { requirementId?: unknown } | null | undefined;
  if (destination == null || destination.requirementId == null) {
    const { destinationDecision: _destinationDecision, ...rest } = record;
    return rest;
  }
  return value;
}

/** Strict-JSON providers express optional fields as null; the contract uses omission. */
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

class ProjectMapperAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: ProjectMapperStrategy;

  public constructor(manifest: AgentManifest, strategy: ProjectMapperStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(request: AgentInvocationRequest, context: SpecializedAgentContext): Promise<MappingPatch> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createProjectMapperAgent(
  strategy: ProjectMapperStrategy = deterministicProjectMapperStrategy,
): SpecializedAgent {
  return new ProjectMapperAgent(projectMapperAgentManifest, strategy);
}

export const projectMapperAgent: SpecializedAgent = createProjectMapperAgent();
