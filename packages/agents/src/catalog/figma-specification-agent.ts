// packages/agents/src/catalog/figma-specification-agent.ts
import {
  agentManifestSchema,
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  modelProfileSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type DesignSpecification,
  type DesignSpecificationAmbiguity,
  type DesignSpecificationComponent,
  type FigmaNodeSnapshot,
  type FigmaSourceSnapshot,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";

/**
 * The Figma Specification Agent.
 *
 * Turns a `FigmaSourceSnapshot` into a `DesignSpecification` — the first of
 * the Design Engineer's three specialized agents. Stage 2 shipped this
 * agent against a pure fixture snapshot; Stage 3 replaces the snapshot's
 * *content* with a real, MCP-retrieved one (`@designflow/capability-figma-mcp`
 * builds it — this agent never calls Figma, never calls an MCP client, and
 * has no tool access at all: `allowedTools` stays empty). The agent's own
 * job is unchanged in kind: interpret whatever snapshot it is handed,
 * faithfully, and say explicitly what it could not determine.
 *
 * Two strategies, the same split every other specialized agent uses:
 * deterministic (offline, derives the specification purely from the
 * snapshot's own structure — the strategy every test in this package
 * exercises by default) and model-backed (consults the same snapshot through
 * a structured prompt that states the snapshot is authoritative and forbids
 * fabrication). Both strategies' output passes through the same
 * `validate()` — including, now, a check that every node id a produced
 * component or hierarchy entry references actually exists in the source
 * snapshot. A model (or a bug in the deterministic strategy) naming a node
 * id the snapshot never had is exactly the "fabricated node id" failure
 * mode `SpecializedAgentOutputInvalidError` exists to catch before it
 * reaches a stored artifact.
 */

const MODEL_PROFILE_ID = "figma-specification-default";

export const figmaSpecificationAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "figma-specification-agent",
  name: "Figma Specification Agent",
  description: "Turns a Figma source snapshot into a design specification",
  version: "0.2.0",
  instructions:
    "The supplied Figma source snapshot is authoritative — it is everything you " +
    "know about this design. Never invent a property, a node, a token or an " +
    "asset the snapshot does not contain. Every component and hierarchy entry " +
    "you name must reference a real node id from the snapshot. Distinguish " +
    "observed facts (already present in the snapshot) from your own inferred " +
    "implementation guidance. Every unresolved question must appear as a " +
    "structured ambiguity, never silently guessed at. Respond with structured " +
    "output only.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-figma-specification"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const figmaSpecificationDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  model: "openai/gpt-4o-mini",
});

export type FigmaSpecificationStrategy = (
  request: AgentInvocationRequest,
  context: SpecializedAgentContext,
  manifest: AgentManifest,
) => Promise<DesignSpecification>;

function readSnapshot(request: AgentInvocationRequest): FigmaSourceSnapshot {
  const parsed = figmaSourceSnapshotSchema.safeParse(
    (request.input as { figmaSnapshot?: unknown } | undefined)?.figmaSnapshot,
  );

  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError("figma-specification-agent", [
      "input.figmaSnapshot: missing or does not match FigmaSourceSnapshot",
    ]);
  }

  return parsed.data;
}

/**
 * Validates the produced specification against its own schema, *and* that
 * every node id it references (hierarchy entries, component
 * `sourceNodeIds`, ambiguity `affectedNodeIds`) exists in the snapshot it
 * was derived from — the check that catches a fabricated node id, whichever
 * strategy produced it.
 */
function validate(
  agentVersion: string,
  raw: unknown,
  snapshot: FigmaSourceSnapshot,
): DesignSpecification {
  const withVersion = typeof raw === "object" && raw !== null ? { ...raw, agentVersion } : raw;
  const parsed = designSpecificationSchema.safeParse(withVersion);

  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      "figma-specification-agent",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  const spec = parsed.data;
  const knownIds = new Set(snapshot.nodes.map((node) => node.id));

  const referenced = [
    ...spec.hierarchy.map((entry) => entry.id),
    ...spec.components.flatMap((component) => component.sourceNodeIds),
    ...spec.ambiguities.flatMap((ambiguity) => ambiguity.affectedNodeIds),
  ];

  const fabricated = referenced.filter((id) => !knownIds.has(id));
  if (fabricated.length > 0) {
    throw new SpecializedAgentOutputInvalidError("figma-specification-agent", [
      `referenced node id(s) not present in the source snapshot: ${[...new Set(fabricated)].join(", ")}`,
    ]);
  }

  return spec;
}

// ── Deterministic derivation helpers ─────────────────────────────

function hierarchyFrom(nodes: readonly FigmaNodeSnapshot[]): DesignSpecification["hierarchy"] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
  }));
}

const COMPONENT_LIKE_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE", "FRAME"]);

/** Semantic components: real component/instance nodes first, top-level frames otherwise. */
function componentsFrom(
  nodes: readonly FigmaNodeSnapshot[],
  resolvedFrameIds: ReadonlySet<string>,
): DesignSpecificationComponent[] {
  const candidates = nodes.filter(
    (node) => resolvedFrameIds.has(node.id) || node.componentId !== undefined || node.type === "COMPONENT",
  );

  const source = candidates.length > 0 ? candidates : nodes.filter((node) => COMPONENT_LIKE_TYPES.has(node.type));

  return source.map((node) => ({
    name: node.name,
    role: node.type,
    sourceNodeIds: [node.id],
    variants: node.variantProperties !== undefined ? Object.values(node.variantProperties) : [],
    reusableAssessment: node.componentId !== undefined ? ("reusable" as const) : ("uncertain" as const),
    requiredAssets: [],
    implementationNotes: [],
  }));
}

function designTokensFrom(snapshot: FigmaSourceSnapshot): DesignSpecification["designTokens"] {
  const colorVariables = snapshot.variables
    .filter((variable) => variable.name.toLowerCase().includes("color"))
    .map((variable) => variable.name);

  const spacingValues = [
    ...new Set(
      snapshot.nodes.flatMap((node) => (node.itemSpacing !== undefined ? [node.itemSpacing] : [])),
    ),
  ].sort((a, b) => a - b);

  const typographyNodes = snapshot.nodes.filter((node) => node.characters !== undefined);

  return {
    colors: colorVariables,
    spacing: spacingValues.map((value) => `space.${value}`),
    typography: typographyNodes.length > 0 ? ["type.body"] : [],
    radii: [
      ...new Set(
        snapshot.nodes.flatMap((node) => (node.cornerRadius !== undefined ? [`radius.${node.cornerRadius}`] : [])),
      ),
    ],
    borders: [],
    shadows: [],
    referencedVariableNames: snapshot.variables.map((variable) => variable.name),
  };
}

function ambiguitiesFrom(
  snapshot: FigmaSourceSnapshot,
  resolvedFrameIds: readonly string[],
): DesignSpecificationAmbiguity[] {
  const ambiguities: DesignSpecificationAmbiguity[] = [];

  if (snapshot.nodes.length === 0) {
    ambiguities.push({
      code: "NO_NODES_RETRIEVED",
      description: "The source snapshot carries no nodes; structure could not be inferred.",
      affectedNodeIds: [],
      requiresUserInput: true,
      suggestedQuestion: "Which frame or node should be inspected?",
    });
  }

  if (!snapshot.capabilities.screenshotsAvailable || snapshot.screenshots.length === 0) {
    ambiguities.push({
      code: "NO_REFERENCE_SCREENSHOT",
      description: "No reference screenshot was available for visual comparison.",
      affectedNodeIds: [...resolvedFrameIds],
      requiresUserInput: false,
    });
  }

  const hasAutoLayout = snapshot.nodes.some((node) => node.layoutMode !== undefined && node.layoutMode !== "NONE");
  if (!hasAutoLayout) {
    ambiguities.push({
      code: "RESPONSIVE_BREAKPOINT_NOT_SPECIFIED",
      description: "No auto-layout data was present to infer responsive behaviour from.",
      affectedNodeIds: [],
      requiresUserInput: true,
      suggestedQuestion: "What breakpoints or responsive behaviour should this implementation support?",
    });
  }

  if (!snapshot.capabilities.variablesAvailable && !snapshot.capabilities.stylesAvailable) {
    ambiguities.push({
      code: "NO_DESIGN_TOKEN_SOURCE",
      description: "The connected server exposed neither variables nor styles; tokens could not be sourced from Figma directly.",
      affectedNodeIds: [],
      requiresUserInput: false,
    });
  }

  for (const warning of snapshot.warnings) {
    ambiguities.push({
      code: warning.code,
      description: warning.message,
      affectedNodeIds: warning.nodeId !== undefined ? [warning.nodeId] : [],
      requiresUserInput: false,
    });
  }

  return ambiguities;
}

export const deterministicFigmaSpecificationStrategy: FigmaSpecificationStrategy = async (
  request,
  _context,
  manifest,
) => {
  const snapshot = readSnapshot(request);
  const resolvedFrameIds = new Set(snapshot.source.resolvedFrames.map((frame) => frame.id));

  const spec = {
    sourceIdentity: {
      designFile: snapshot.source.designFile,
      ...(snapshot.source.fileKey !== undefined ? { fileKey: snapshot.source.fileKey } : {}),
      ...(snapshot.source.documentVersion !== undefined
        ? { documentVersion: snapshot.source.documentVersion }
        : {}),
    },
    screenshotArtifactIds: snapshot.screenshots.map((screenshot) => screenshot.artifactId),
    frames: snapshot.source.frames.length > 0 ? snapshot.source.frames : snapshot.source.resolvedFrames.map((frame) => frame.name),
    hierarchy: hierarchyFrom(snapshot.nodes),
    designTokens: designTokensFrom(snapshot),
    components: componentsFrom(snapshot.nodes, resolvedFrameIds),
    layoutBehavior: snapshot.nodes.some((node) => node.layoutMode === "HORIZONTAL")
      ? ["at least one frame lays its children out horizontally"]
      : snapshot.nodes.some((node) => node.layoutMode === "VERTICAL")
        ? ["at least one frame lays its children out vertically"]
        : [],
    responsiveAssumptions: [],
    assets: snapshot.assets.map((asset) => ({ id: asset.id, name: asset.name })),
    content: snapshot.nodes.flatMap((node) => (node.characters !== undefined ? [node.characters] : [])),
    interactions: [],
    states: [],
    accessibilityNotes:
      snapshot.nodes.length > 0 ? ["ensure interactive elements carry an accessible name"] : [],
    ambiguities: ambiguitiesFrom(snapshot, [...resolvedFrameIds]),
  };

  return validate(manifest.version, spec, snapshot);
};

export const modelFigmaSpecificationStrategy: FigmaSpecificationStrategy = async (
  request,
  context,
  manifest,
) => {
  const snapshot = readSnapshot(request);

  const result = await context.model.generate({
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Objective: ${request.objective}\n\n` +
          `Figma source snapshot (authoritative — do not invent anything beyond it):\n${JSON.stringify(snapshot)}`,
      },
    ],
    responseSchema: { type: "object" },
    maxOutputTokens: 2000,
  });

  if (result.type === "failure") {
    throw new SpecializedAgentOutputInvalidError("figma-specification-agent", [
      `model call failed: ${result.code}`,
    ]);
  }

  return validate(manifest.version, result.output, snapshot);
};

class FigmaSpecificationAgent implements SpecializedAgent {
  public readonly manifest: AgentManifest;
  private readonly strategy: FigmaSpecificationStrategy;

  public constructor(manifest: AgentManifest, strategy: FigmaSpecificationStrategy) {
    this.manifest = manifest;
    this.strategy = strategy;
  }

  public perform(
    request: AgentInvocationRequest,
    context: SpecializedAgentContext,
  ): Promise<DesignSpecification> {
    return this.strategy(request, context, this.manifest);
  }
}

export function createFigmaSpecificationAgent(
  strategy: FigmaSpecificationStrategy = deterministicFigmaSpecificationStrategy,
): SpecializedAgent {
  return new FigmaSpecificationAgent(figmaSpecificationAgentManifest, strategy);
}

export const figmaSpecificationAgent: SpecializedAgent = createFigmaSpecificationAgent();
