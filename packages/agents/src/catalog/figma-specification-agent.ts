// packages/agents/src/catalog/figma-specification-agent.ts
import {
  agentManifestSchema,
  designSpecificationSchema,
  figmaSourceSnapshotSchema,
  modelProfileSchema,
  type AgentInvocationRequest,
  type AgentManifest,
  type DesignSpecification,
  type FigmaSourceSnapshot,
  type ModelProfile,
  type SpecializedAgent,
  type SpecializedAgentContext,
} from "@designflow/sdk";

import { SpecializedAgentOutputInvalidError } from "../errors";

/**
 * The Figma Specification Agent.
 *
 * Turns a Figma source snapshot into a Design Specification — the first of
 * the Design Engineer's three specialized agents. In this stage the
 * "snapshot" is always a fixture `prepare-figma-source-fixture` constructed
 * from workflow input, never a real Figma MCP response: this agent has no
 * network access and no MCP tool, by construction — its `allowedTools` is
 * empty and nothing in either strategy reaches outside its own input.
 *
 * Two strategies, the same split `design-engineer-agent.ts` documents:
 * deterministic (offline, derives the specification purely from the
 * snapshot's own structure) and model-backed (consults the same snapshot
 * through a structured prompt). Neither ever produces output that skips
 * `designSpecificationSchema` — an invalid model answer becomes a thrown
 * `SpecializedAgentOutputInvalidError`, which `AgentInvocationRuntime` turns
 * into a `failure` outcome rather than a decision made on unchecked data.
 */

const MODEL_PROFILE_ID = "figma-specification-default";

export const figmaSpecificationAgentManifest: AgentManifest = agentManifestSchema.parse({
  id: "figma-specification-agent",
  name: "Figma Specification Agent",
  description: "Turns a Figma source snapshot into a design specification",
  version: "0.1.0",
  instructions:
    "Read the supplied Figma source snapshot and produce a comprehensive design " +
    "specification: hierarchy, tokens, components, layout behaviour, responsive " +
    "assumptions, assets, interactions, accessibility notes, and any ambiguity " +
    "the snapshot leaves unresolved. Never fetch anything — only the snapshot " +
    "you were given exists.",
  allowedWorkflows: ["design-to-code-agent-foundation"],
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
    throw new SpecializedAgentOutputInvalidError(
      "figma-specification-agent",
      ["input.figmaSnapshot: missing or does not match FigmaSourceSnapshot"],
    );
  }

  return parsed.data;
}

function validate(agentVersion: string, raw: unknown): DesignSpecification {
  const withVersion =
    typeof raw === "object" && raw !== null ? { ...raw, agentVersion } : raw;
  const parsed = designSpecificationSchema.safeParse(withVersion);

  if (!parsed.success) {
    throw new SpecializedAgentOutputInvalidError(
      "figma-specification-agent",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }

  return parsed.data;
}

/** Groups nodes by their `parentId`-less top level, treated as "frames" already named on the source. */
function componentsFrom(snapshot: FigmaSourceSnapshot): DesignSpecification["components"] {
  return snapshot.nodes
    .filter((node) => node.parentId !== undefined)
    .map((node) => ({ name: node.name, role: node.type }));
}

export const deterministicFigmaSpecificationStrategy: FigmaSpecificationStrategy = async (
  request,
  _context,
  manifest,
) => {
  const snapshot = readSnapshot(request);

  const colorVariables = snapshot.variables
    .filter((variable) => variable.name.toLowerCase().includes("color"))
    .map((variable) => variable.name);

  const spec = {
    sourceIdentity: {
      designFile: snapshot.source.designFile,
      ...(snapshot.source.fileKey !== undefined ? { fileKey: snapshot.source.fileKey } : {}),
    },
    frames: snapshot.source.frames,
    hierarchy: snapshot.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
    })),
    designTokens: {
      colors: colorVariables.length > 0 ? colorVariables : ["color.default"],
      spacing: ["space.sm", "space.md", "space.lg"],
      typography: ["type.body", "type.heading"],
    },
    components: componentsFrom(snapshot),
    layoutBehavior: ["stacked vertically on narrow viewports"],
    responsiveAssumptions: ["single breakpoint at 768px"],
    assets: snapshot.assets.map((asset) => ({ id: asset.id, name: asset.name })),
    interactions: [],
    accessibilityNotes: ["ensure interactive elements carry an accessible name"],
    ambiguities:
      snapshot.nodes.length === 0
        ? ["snapshot carries no nodes; component structure could not be inferred"]
        : [],
  };

  return validate(manifest.version, spec);
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
          `Figma source snapshot:\n${JSON.stringify(snapshot)}`,
      },
    ],
    responseSchema: { type: "object" },
    maxOutputTokens: 1200,
  });

  if (result.type === "failure") {
    throw new SpecializedAgentOutputInvalidError("figma-specification-agent", [
      `model call failed: ${result.code}`,
    ]);
  }

  return validate(manifest.version, result.output);
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
