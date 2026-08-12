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
  type SpecElement,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";
import { figmaSpecificationResponseSchema } from "../model-response-schemas";
import { wireToDesignSpecification } from "./specification-wire";
import { generateValidatedModelOutput } from "../model-structured-output";

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
  description: "Turns a Figma source snapshot into an implementation-grade design specification",
  version: "0.3.0",
  instructions:
    "Produce an implementation-grade design specification from the supplied " +
    "normalized Figma evidence. The snapshot is authoritative — it is everything " +
    "you know about this design; never invent a node, property, token, asset, " +
    "variant, state or behavior it does not contain, and never produce code or " +
    "decide repository reuse.\n\n" +
    "Be exhaustive about implementation-relevant evidence:\n" +
    "- Preserve exact numeric and style values (dimensions, padding, gaps, radii, " +
    "borders, fills, opacity, effects) instead of summarizing them away.\n" +
    "- Preserve exact visible copy verbatim in `content` and on the elements that " +
    "carry it; never replace real text with generic summaries.\n" +
    "- Describe the screen in visual/hierarchical order in `anatomy`: ordered " +
    "top-level regions, each containing its own nested elements with their " +
    "layout, style and typography facts. Do not collapse structure into one " +
    "flat name list, and do not enumerate every trivial vector node — include " +
    "what an implementer needs.\n" +
    "- Fill `screen` with the selected root's name and evidenced dimensions, " +
    "layout model and background.\n" +
    "- Reason about repeated component instances: emit a `componentContracts` " +
    "entry per design component with its anatomy, shared base styles, evidenced " +
    "properties/variants/states, and every observed instance with its " +
    "instance-specific differences. Mark each property/variant source as " +
    "observedInSelection or declaredByFigmaComponentMetadata; never fabricate " +
    "variants a single instance cannot prove.\n" +
    "- Fill `foundations` with structured values, distinguishing named Figma " +
    "variables (source figma-variable) from repeated raw values (source " +
    "observed-value). Never label a raw value as a named token.\n" +
    "- Record only evidence-supported interaction facts: put visually evidenced " +
    "states in `observedStates` and affordance-suggested but unconfirmed " +
    "behavior in `inferredBehavior`.\n" +
    "- In `responsiveEvidence`, record explicit constraint/auto-layout evidence; " +
    "if only one fixed frame exists, say exactly that.\n" +
    "- Accessibility: only evidence-derived facts or recommendations clearly " +
    "labeled as recommendations.\n" +
    "- Every node id you reference must exist in the snapshot. Every uncertainty " +
    "must be a specific, structured ambiguity naming what is missing — never a " +
    "generic 'behavior is unclear'.\n" +
    "Also populate the legacy summary fields (frames, hierarchy, designTokens, " +
    "components, content, interactions, states) consistently with the richer " +
    "sections. Respond with structured output only.",
  allowedWorkflows: ["design-to-code-agent-foundation", "design-to-code-figma-specification"],
  allowedTools: [],
  modelProfileId: MODEL_PROFILE_ID,
  metadata: { author: "DesignFlow" },
});

export const figmaSpecificationDefaultModelProfile: ModelProfile = modelProfileSchema.parse({
  id: MODEL_PROFILE_ID,
  providerId: "openrouter",
  // The Specification AI's ordered model policy (Specification AI only —
  // every other agent keeps its own independent profile). The runtime tries
  // these in exactly this order, advancing only on capability/availability
  // failures; if none can execute the structured-output contract, the run
  // fails truthfully with the bounded attempt provenance.
  model: "openai/gpt-5.6-luna",
  fallbackModels: ["deepseek/deepseek-v4-pro", "openai/gpt-4o-mini"],
  // Specification V2 streams up to 8000 output tokens from rich Figma
  // evidence; the field run 101df3e3 proved the inherited 30s default is
  // too small (Luna was cut at exactly 30006ms). 120s is the documented
  // per-profile ceiling and covers the 8000-token worst case at realistic
  // provider throughput. Other agents keep the 30s default.
  timeoutMs: 120_000,
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
/** Strict-JSON providers express optional fields as null; the Zod contract uses omission. */
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

function elementNodeIds(elements: readonly { nodeId?: string | undefined; children: readonly unknown[] }[]): string[] {
  return elements.flatMap((element) => [
    ...(element.nodeId !== undefined ? [element.nodeId] : []),
    ...elementNodeIds(element.children as never),
  ]);
}

function validate(
  agentVersion: string,
  raw: unknown,
  snapshot: FigmaSourceSnapshot,
): DesignSpecification {
  const cleaned = stripNulls(raw);
  const withVersion = typeof cleaned === "object" && cleaned !== null ? { ...cleaned, agentVersion } : cleaned;
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
    ...spec.anatomy.flatMap((region) => [
      ...(region.nodeId !== undefined ? [region.nodeId] : []),
      ...elementNodeIds(region.elements),
    ]),
    ...spec.componentContracts.flatMap((contract) => [
      ...contract.sourceNodeIds,
      ...contract.instances.flatMap((instance) => (instance.nodeId !== undefined ? [instance.nodeId] : [])),
    ]),
  ];

  const fabricated = referenced.filter((id) => !knownIds.has(id));
  if (fabricated.length > 0) {
    throw new SpecializedAgentOutputInvalidError("figma-specification-agent", [
      `referenced node id(s) not present in the source snapshot: ${[...new Set(fabricated)].join(", ")}`,
    ]);
  }

  const completeness = completenessIssues(spec, snapshot);
  if (completeness.length > 0) {
    throw new SpecializedAgentOutputInvalidError("figma-specification-agent", completeness);
  }

  return spec;
}

/**
 * Evidence-relative completeness (Specification V2). A successful
 * specification must not be materially emptier than the evidence it was
 * derived from. No arbitrary minimum counts: every check compares the
 * specification against what the snapshot actually contains.
 */
function completenessIssues(
  spec: DesignSpecification,
  snapshot: FigmaSourceSnapshot,
): string[] {
  const issues: string[] = [];

  if (snapshot.nodes.length > 0 && spec.hierarchy.length === 0 && spec.anatomy.length === 0) {
    issues.push("completeness: the snapshot carries nodes but the specification describes no screen hierarchy");
  }

  const evidencedText = snapshot.nodes.filter((node) => (node.characters ?? "").trim().length > 0);
  if (evidencedText.length > 0 && spec.content.length === 0) {
    issues.push(`completeness: the snapshot carries ${evidencedText.length} text node(s) but the specification preserves no content`);
  }

  const componentEvidence =
    snapshot.components.length > 0 ||
    snapshot.nodes.some((node) => node.componentId !== undefined || node.type === "COMPONENT" || node.type === "INSTANCE");
  if (componentEvidence && spec.components.length === 0 && spec.componentContracts.length === 0) {
    issues.push("completeness: the snapshot carries component evidence but the specification names no components");
  }

  const styleEvidence = snapshot.nodes.some(
    (node) =>
      node.fills.length > 0 ||
      node.strokes.length > 0 ||
      node.effects.length > 0 ||
      node.cornerRadius !== undefined ||
      node.itemSpacing !== undefined,
  );
  const styleCaptured =
    spec.foundations !== undefined ||
    spec.designTokens.colors.length > 0 ||
    spec.designTokens.spacing.length > 0 ||
    spec.designTokens.typography.length > 0 ||
    spec.designTokens.radii.length > 0 ||
    spec.designTokens.borders.length > 0 ||
    spec.designTokens.shadows.length > 0;
  if (styleEvidence && !styleCaptured) {
    issues.push("completeness: the snapshot carries style evidence (fills/strokes/effects/radii/spacing) but every style section is empty");
  }

  return issues;
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

// ── Deterministic V2 derivation ──────────────────────────────────

function solidColorOf(paint: Record<string, unknown>): string | undefined {
  const color = paint["color"];
  if (typeof color !== "object" || color === null) return undefined;
  const { r, g, b } = color as { r?: unknown; g?: unknown; b?: unknown };
  if (typeof r !== "number" || typeof g !== "number" || typeof b !== "number") return undefined;
  const hex = (channel: number): string => Math.round(channel * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function elementFrom(node: FigmaNodeSnapshot, byId: ReadonlyMap<string, FigmaNodeSnapshot>, depth: number): SpecElement {
  const width = node.absoluteBoundingBox?.width ?? node.relativeBoundingBox?.width;
  const height = node.absoluteBoundingBox?.height ?? node.relativeBoundingBox?.height;
  const background = node.fills.map(solidColorOf).find((value) => value !== undefined);
  return {
    nodeId: node.id,
    name: node.name,
    ...(node.type === "TEXT" ? { role: "text" } : node.componentId !== undefined ? { role: "component-instance" } : {}),
    ...(node.characters !== undefined ? { text: node.characters } : {}),
    ...(width !== undefined ? { width: `${width}px` } : {}),
    ...(height !== undefined ? { height: `${height}px` } : {}),
    ...(node.layoutMode !== undefined && node.layoutMode !== "NONE"
      ? {
          layout: {
            direction: node.layoutMode === "HORIZONTAL" ? ("horizontal" as const) : ("vertical" as const),
            ...(node.itemSpacing !== undefined ? { gap: `${node.itemSpacing}px` } : {}),
            ...(node.padding !== undefined
              ? { padding: `${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px` }
              : {}),
          },
        }
      : {}),
    ...(background !== undefined ? { background } : {}),
    ...(node.cornerRadius !== undefined ? { radius: `${node.cornerRadius}px` } : {}),
    ...(node.opacity !== undefined ? { opacity: node.opacity } : {}),
    effects: [],
    states: [],
    notes: [],
    children: depth > 0
      ? node.childIds
          .map((childId) => byId.get(childId))
          .filter((child): child is FigmaNodeSnapshot => child !== undefined)
          .map((child) => elementFrom(child, byId, depth - 1))
      : [],
  };
}

function anatomyFrom(snapshot: FigmaSourceSnapshot): { screen?: import("@designflow/sdk").SpecScreen; anatomy: import("@designflow/sdk").SpecRegion[] } {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const root = snapshot.nodes.find((node) => node.parentId === undefined) ?? snapshot.nodes[0];
  if (root === undefined) return { anatomy: [] };
  const rootWidth = root.absoluteBoundingBox?.width ?? root.relativeBoundingBox?.width;
  const rootHeight = root.absoluteBoundingBox?.height ?? root.relativeBoundingBox?.height;
  const rootBackground = root.fills.map(solidColorOf).find((value) => value !== undefined);
  const screen = {
    name: root.name,
    ...(rootWidth !== undefined ? { width: `${rootWidth}px` } : {}),
    ...(rootHeight !== undefined ? { height: `${rootHeight}px` } : {}),
    ...(root.layoutMode !== undefined && root.layoutMode !== "NONE"
      ? { layoutModel: root.layoutMode === "HORIZONTAL" ? "horizontal auto-layout" : "vertical auto-layout" }
      : {}),
    ...(rootBackground !== undefined ? { background: rootBackground } : {}),
  };
  const anatomy = root.childIds
    .map((childId) => byId.get(childId))
    .filter((child): child is FigmaNodeSnapshot => child !== undefined)
    .map((child) => ({
      nodeId: child.id,
      name: child.name,
      elements: [elementFrom(child, byId, 2)],
    }));
  return { screen, anatomy };
}

function foundationsFrom(snapshot: FigmaSourceSnapshot): import("@designflow/sdk").SpecFoundations {
  const observed = (values: readonly string[]): { value: string; source: "observed-value" }[] =>
    [...new Set(values)].map((value) => ({ value, source: "observed-value" as const }));
  const colors = observed(
    snapshot.nodes.flatMap((node) => node.fills.map(solidColorOf).filter((value): value is string => value !== undefined)),
  );
  const variableColors = snapshot.variables
    .filter((variable) => variable.name.toLowerCase().includes("color"))
    .map((variable) => ({
      value: typeof variable.value === "string" ? variable.value : variable.name,
      name: variable.name,
      source: "figma-variable" as const,
    }));
  return {
    colors: [...variableColors, ...colors],
    typography: [],
    spacing: observed(snapshot.nodes.flatMap((node) => (node.itemSpacing !== undefined ? [`${node.itemSpacing}px`] : []))),
    radii: observed(snapshot.nodes.flatMap((node) => (node.cornerRadius !== undefined ? [`${node.cornerRadius}px`] : []))),
    borders: [],
    shadows: [],
    iconSizing: [],
  };
}

export const deterministicFigmaSpecificationStrategy: FigmaSpecificationStrategy = async (
  request,
  _context,
  manifest,
) => {
  const snapshot = readSnapshot(request);
  const resolvedFrameIds = new Set(snapshot.source.resolvedFrames.map((frame) => frame.id));
  const { screen, anatomy } = anatomyFrom(snapshot);

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
    ...(screen !== undefined ? { screen } : {}),
    anatomy,
    foundations: foundationsFrom(snapshot),
    assetDetails: snapshot.assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      ...(asset.reference !== undefined ? { reference: asset.reference } : {}),
    })),
    responsiveEvidence: snapshot.nodes.some((node) => node.layoutMode !== undefined && node.layoutMode !== "NONE")
      ? ["Auto-layout evidence exists on at least one frame."]
      : ["Only fixed-position evidence is available; no responsive behavior is evidenced."],
  };

  return validate(manifest.version, spec, snapshot);
};

export const modelFigmaSpecificationStrategy: FigmaSpecificationStrategy = async (
  request,
  context,
  manifest,
) => {
  const snapshot = readSnapshot(request);

  return generateValidatedModelOutput({
    agentId: "figma-specification-agent",
    context,
    messages: [
      { role: "system", content: manifest.instructions },
      {
        role: "user",
        content:
          `Objective: ${request.objective}\n\n` +
          `Figma source snapshot (authoritative — do not invent anything beyond it):\n${JSON.stringify(snapshot)}`,
      },
    ],
    responseSchema: figmaSpecificationResponseSchema,
    // Specification V2 carries element-level styles, component contracts and
    // exact copy — 2000 tokens forced the model to discard evidence.
    maxOutputTokens: 8000,
    // Portable wire response → deterministic normalization → the same
    // authoritative validation (schema, node ids, completeness) every other
    // strategy passes through. Normalization failures feed the bounded
    // same-model repair loop like any other validation issue.
    validate: (output) => {
      const root = snapshot.nodes.find((node) => node.parentId === undefined) ?? snapshot.nodes[0];
      const internal = wireToDesignSpecification(stripNulls(output), {
        fallbackRootNodeId: root?.id,
        screenshotArtifactIds: snapshot.screenshots.map((screenshot) => screenshot.artifactId),
      });
      return validate(manifest.version, internal, snapshot);
    },
  });
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
