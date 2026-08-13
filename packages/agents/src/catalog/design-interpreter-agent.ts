// packages/agents/src/catalog/design-interpreter-agent.ts
//
// The Design Interpreter (Agent Architecture V2, AI role A).
//
// It answers exactly one question, for one bounded partition of a Blueprint:
// *what do these evidenced nodes mean for an implementer?* It never restates
// a dimension, a color or a string of copy — those are compiled facts it
// cannot express, because the patch contract has no field for them.
//
// This is deliberately a new module rather than an evolution of
// `figma-specification-agent.ts`: the legacy agent stays wired to the current
// flagship path until V2 migration completes, and it carries uncommitted
// third-party edits this task must not disturb.
//
// The shape of the request is the whole point. The legacy Specification agent
// made one enormous call to author a whole document; this one makes several
// small calls, each carrying a handful of elements and an explicit list of
// the ids it is allowed to annotate.
import {
  agentManifestSchema,
  modelProfileSchema,
  uiSemanticPatchSchema,
  UI_SEMANTIC_PATCH_SCHEMA_VERSION,
  type AgentInvocationRequest,
  type AgentManifest,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
  type UISemanticPatch,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { generateValidatedModelOutput } from "../model-structured-output";
import { uiSemanticPatchResponseSchema } from "../model-response-schemas";
import type { BlueprintPartition } from "./ui-blueprint-partition";

const MODEL_PROFILE_ID = "design-interpreter-default";

export const DESIGN_INTERPRETER_AGENT_ID = "design-interpreter-agent";
export const DESIGN_INTERPRETER_AGENT_VERSION = "0.1.0";

export const designInterpreterAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: DESIGN_INTERPRETER_AGENT_ID,
  name: "Design Interpreter",
  description: "Adds bounded semantic meaning to a compiled UI Blueprint partition",
  version: DESIGN_INTERPRETER_AGENT_VERSION,
  instructions:
    "You annotate the MEANING of an already-compiled design. The facts you are " +
    "shown — names, text, dimensions, layout, component identity — are compiled " +
    "deterministically from Figma and are not yours to restate, correct or " +
    "reproduce. Return only semantic annotations.\n\n" +
    "For the supplied partition:\n" +
    "- Give each implementation-relevant element a `role` and, where it is " +
    "genuinely informative, a short snake_case `purpose` (for example " +
    "`amount_input`, `payment_method_selector`, `primary_submit`).\n" +
    "- Give interactive elements an `interactionKind`.\n" +
    "- Group related elements into named semantic regions (Header, Tabs, " +
    "Add Expense Form, Expense History, Bottom Navigation). Every member must " +
    "be an id from the allowed list; you may not introduce a node.\n" +
    "- Record relationships only where the evidence supports them (a label for " +
    "a field, a control that submits a form).\n" +
    "- Set `evidenceBasis` honestly on every annotation: " +
    "`explicit_design_evidence` or `component_metadata` when the supplied facts " +
    "say it outright, `visual_inference` or `semantic_inference` when you are " +
    "reading meaning into them. Never present an inference as design evidence.\n" +
    "- Where you genuinely cannot tell, add a specific `uncertainty` naming what " +
    "is missing rather than guessing.\n\n" +
    "Never output code, file paths, imports, framework or styling choices, or " +
    "any decision about the user's repository — those are other agents' work. " +
    "Never output dimensions, colors, radii, typography, copy or variants: they " +
    "are already known, and the response contract has nowhere to put them. " +
    "Only annotate ids present in the allowed lists. Respond with structured " +
    "output only.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-figma-specification"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const designInterpreterDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  // The same ordered-candidate policy every agent uses, with the candidate
  // field evidence actually supports first.
  model: "openai/gpt-4o-mini",
  fallbackModels: ["openai/gpt-5.6-luna", "deepseek/deepseek-v4-pro"],
  // No raised timeout, deliberately. A semantic patch for one partition is a
  // small structured answer; if it ever needs a 145-second budget, the
  // partition is too big and the fix is to partition further — not to wait
  // longer. The default applies.
});

/**
 * Output budget for one patch.
 *
 * Measured against the Spendly fixture: the largest partition patch
 * serializes to well under 4 KB (~1k tokens) including every annotation, its
 * regions and its relationships. 2000 leaves roughly a 2× margin over the
 * measured maximum while staying an order of magnitude below the legacy
 * document-sized ceiling that produced the truncation failures.
 */
export const MAX_SEMANTIC_PATCH_OUTPUT_TOKENS = 2000;

export interface DesignInterpreterInput {
  readonly partition: BlueprintPartition;
}

export type DesignInterpreterStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<UISemanticPatch>;

function readPartition(request: AgentInvocationRequest): BlueprintPartition {
  const raw = (request.input as { partition?: unknown } | undefined)?.partition;
  const partition = raw as BlueprintPartition | undefined;
  if (
    partition === undefined ||
    typeof partition.id !== "string" ||
    !Array.isArray(partition.allowedElementIds) ||
    !Array.isArray(partition.allowedComponentIds)
  ) {
    throw new SpecializedAgentOutputInvalidError(DESIGN_INTERPRETER_AGENT_ID, [
      "input.partition: missing or does not match a Blueprint enrichment partition",
    ]);
  }
  return partition;
}

/** Rejects anything the partition did not authorize this patch to touch. */
function validateAgainstPartition(raw: unknown, partition: BlueprintPartition): UISemanticPatch {
  // The wire schema carries annotations only; identity is host-owned so a
  // model can neither claim a different partition nor a different contract.
  const withPartition =
    typeof raw === "object" && raw !== null
      ? {
          ...(raw as Record<string, unknown>),
          schemaVersion: UI_SEMANTIC_PATCH_SCHEMA_VERSION,
          partitionId: partition.id,
        }
      : raw;
  const parsed = uiSemanticPatchSchema.safeParse(withPartition);
  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      DESIGN_INTERPRETER_AGENT_ID,
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const patch = parsed.data;
  const allowedElements = new Set(partition.allowedElementIds);
  const allowedComponents = new Set(partition.allowedComponentIds);
  const outside: string[] = [];

  for (const annotation of patch.elementAnnotations) {
    if (!allowedElements.has(annotation.elementId)) outside.push(annotation.elementId);
  }
  for (const annotation of patch.componentAnnotations) {
    if (!allowedComponents.has(annotation.componentId)) outside.push(annotation.componentId);
  }
  for (const region of patch.regionAnnotations) {
    for (const member of region.memberElementIds) {
      if (!allowedElements.has(member)) outside.push(member);
    }
  }
  for (const relationship of patch.relationships) {
    for (const endpoint of [relationship.fromId, relationship.toId]) {
      if (!allowedElements.has(endpoint) && !allowedComponents.has(endpoint)) outside.push(endpoint);
    }
  }

  if (outside.length > 0) {
    throw new SpecializedAgentOutputInvalidError(DESIGN_INTERPRETER_AGENT_ID, [
      `annotations reference ids outside this partition's allowed set: ${[...new Set(outside)].slice(0, 5).join(", ")}`,
    ]);
  }

  return patch;
}

/**
 * The offline strategy.
 *
 * Returns an empty, valid patch rather than inventing semantics. Deriving a
 * role deterministically would mean guessing meaning from geometry and
 * calling the guess evidence — the exact failure V2 is built to prevent — so
 * when no interpreter model is available the honest answer is "no semantics",
 * and the Blueprint's own facts stand unchanged.
 */
export const deterministicDesignInterpreterStrategy: DesignInterpreterStrategy = async (request) => {
  const partition = readPartition(request);
  return uiSemanticPatchSchema.parse({
    schemaVersion: UI_SEMANTIC_PATCH_SCHEMA_VERSION,
    partitionId: partition.id,
    uncertainties: [
      {
        code: "SEMANTIC_INTERPRETATION_NOT_PERFORMED",
        description:
          "No interpreter model was consulted for this partition; the Blueprint carries its compiled design facts without semantic annotation.",
        affectedIds: [],
        requiresUserInput: false,
      },
    ],
  });
};

export const modelDesignInterpreterStrategy: DesignInterpreterStrategy = async (request, context, manifest) => {
  const partition = readPartition(request);

  return generateValidatedModelOutput({
    agentId: DESIGN_INTERPRETER_AGENT_ID,
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Partition: ${partition.id} (${partition.kind}) — ${partition.title}\n` +
          `Allowed element ids: ${partition.allowedElementIds.join(", ") || "(none)"}\n` +
          `Allowed component ids: ${partition.allowedComponentIds.join(", ") || "(none)"}\n\n` +
          `Compiled facts for this partition (authoritative, do not restate):\n${JSON.stringify(partition.context)}`,
      },
    ],
    responseSchema: uiSemanticPatchResponseSchema,
    maxOutputTokens: MAX_SEMANTIC_PATCH_OUTPUT_TOKENS,
    validate: (output) => validateAgainstPartition(stripNulls(output), partition),
  });
};

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

class DesignInterpreterAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: DesignInterpreterStrategy;

  public constructor(manifest: AgentManifest, strategy: DesignInterpreterStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(request: AgentInvocationRequest, context: SpecializedAgentContext): Promise<UISemanticPatch> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createDesignInterpreterAgent(
  strategy: DesignInterpreterStrategy = deterministicDesignInterpreterStrategy,
): SpecializedAgent {
  return new DesignInterpreterAgent(designInterpreterAgentManifest, strategy);
}

export const designInterpreterAgent: SpecializedAgent = createDesignInterpreterAgent();
