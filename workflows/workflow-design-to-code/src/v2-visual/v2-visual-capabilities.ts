// workflows/workflow-design-to-code/src/v2-visual/v2-visual-capabilities.ts
//
// The executable V2 visual stage.
//
// Each step reads the artifact it depends on and writes its own, so the chain
//
//   UIBlueprint → ProjectContext → ImplementationMap → Builder proposal
//               → RenderedState → VisualDeltaReport
//
// is a real lineage in the artifact store rather than a diagram. Nothing here
// applies files, requests approval or writes to the user's project: the stage
// ends at a persisted report.
//
// The Visual Critic and the deterministic evaluator live in the agents
// package, which this workflow must not import — a workflow package depends on
// the SDK alone. So the evaluator arrives the same way the browser renderer
// already does: injected through `context.config`. When it is absent the stage
// still renders and still persists a RenderedState.
import { z } from "zod";
import {
  DesignFlowError,
  implementationMapSchema,
  proposedFileChangesSchema,
  uiBlueprintSchema,
  visualDeltaReportSchema,
  type Capability,
  type CapabilityContext,
  type RenderedState,
  type Stage4ProjectImplementationContext,
  type UIBlueprint,
  type ImplementationMap,
  type VisualDeltaReport,
} from "@designflow/sdk";
import { inspectRegisteredProject } from "@designflow/capability-implementation";

import { readArtifact, writeArtifact } from "../orchestration/artifact-io";
import { configuredBrowserRenderer, DEFAULT_VISUAL_VIEWPORTS } from "../visual-validation/visual-validation-runtime";
import { renderProposedState, type ReferenceScreenshot } from "../visual-validation/render-proposed-state";
import {
  V2_VISUAL_ARTIFACT_IDS,
  V2_VISUAL_ARTIFACT_TYPES,
  v2VisualStageInputSchema,
  type V2VisualStageInput,
} from "./v2-visual-types";

const outputSchema = z
  .object({
    artifactRef: z.object({ id: z.string(), type: z.string(), metadata: z.record(z.unknown()) }).strict(),
  })
  .strict();

type CapabilityOutput = z.infer<typeof outputSchema>;

/**
 * The seed capabilities are shared with the convergence workflow, whose input
 * extends this stage's with loop-only fields. They read only their own field,
 * so unknown keys pass through rather than failing another stage's contract.
 */
const stageInput = v2VisualStageInputSchema.passthrough();

/** A seed capability requires the field it persists, typed rather than a TypeError. */
function required<T>(value: T | undefined, field: string, capabilityId: string): T {
  if (value === undefined)
    throw new DesignFlowError("ERR_V2_STAGE_INPUT_MISSING", `The V2 stage input is missing "${field}".`, {
      field,
      capabilityId,
    });
  return value;
}

/**
 * The evaluator seam.
 *
 * Deliberately typed structurally rather than imported: this package needs the
 * *shape* of the answer, not the package that produces it.
 */
export interface VisualEvaluator {
  (input: {
    readonly renderedState: RenderedState;
    readonly blueprint: UIBlueprint;
    readonly implementationMap?: ImplementationMap;
  }): Promise<{ readonly report: VisualDeltaReport }>;
}

export function configuredVisualEvaluator(value: unknown): VisualEvaluator | undefined {
  return typeof value === "function" ? (value as VisualEvaluator) : undefined;
}

function base(id: string, name: string, description: string): Omit<Capability<unknown, CapabilityOutput>, "execute"> {
  return { id, name, description, type: "pure", version: "1", inputSchema: z.unknown(), outputSchema };
}

// ── Seeding the canonical V2 inputs ─────────────────────────────

export const storeUIBlueprintCapability: Capability<unknown, CapabilityOutput> = {
  ...base("store-v2-ui-blueprint", "Store UI Blueprint", "Persists the canonical UI Blueprint this stage evaluates against."),
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = stageInput.parse(raw) as V2VisualStageInput;
    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.blueprint,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.blueprint,
      name: "UI Blueprint",
      payload: required(input.blueprint, "blueprint", "store-v2-ui-blueprint"),
      summary: {
        elementCount: required(input.blueprint, "blueprint", "store-v2-ui-blueprint").elements.length,
        componentCount: input.blueprint!.components.length,
        projectFilesChanged: false,
      },
    });
  },
};

export const storeProjectContextCapability: Capability<unknown, CapabilityOutput> = {
  ...base("store-v2-project-context", "Store Project Context", "Persists the canonical Project Context the plan was made against."),
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = stageInput.parse(raw) as V2VisualStageInput;
    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.projectContext,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.projectContext,
      name: "Project Context",
      payload: input.projectContext ?? {},
      summary: { projectId: input.project.id, projectFilesChanged: false },
    });
  },
};

export const storeImplementationMapCapability: Capability<unknown, CapabilityOutput> = {
  ...base("store-v2-implementation-map", "Store Implementation Map", "Persists the canonical Implementation Map the Builder executed."),
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = stageInput.parse(raw) as V2VisualStageInput;
    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.implementationMap,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.implementationMap,
      name: "Implementation Map",
      payload: required(input.implementationMap, "implementationMap", "store-v2-implementation-map"),
      summary: {
        componentCount: input.implementationMap!.components.length,
        blueprintArtifactId: input.implementationMap!.binding.blueprintArtifactId ?? V2_VISUAL_ARTIFACT_IDS.blueprint,
        projectFilesChanged: false,
      },
    });
  },
};

export const storeBuilderProposalCapability: Capability<unknown, CapabilityOutput> = {
  ...base("store-v2-builder-proposal", "Store Builder proposal", "Persists the validated proposal this stage will render."),
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = stageInput.parse(raw) as V2VisualStageInput;
    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.proposal,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.proposal,
      name: "Builder Proposal",
      payload: required(input.proposal, "proposal", "store-v2-builder-proposal"),
      summary: { fileCount: input.proposal!.files.length, projectFilesChanged: false },
    });
  },
};

// ── The stage itself ────────────────────────────────────────────

/**
 * Resolves the design's own screenshots from the artifact store.
 *
 * The canonical Figma evidence already holds these; nothing here generates a
 * reference image, and a reference that cannot be loaded is simply absent —
 * which the comparison reports as `unavailable` rather than as a match.
 */
export async function resolveReferences(
  context: CapabilityContext,
  input: V2VisualStageInput,
): Promise<readonly ReferenceScreenshot[]> {
  const resolved: ReferenceScreenshot[] = [];

  // V2-9: in the flagship, the canonical Figma evidence is already in the
  // run's own snapshot — no input plumbing required. When the caller supplied
  // no explicit references, the design's own screenshot (matched by node id,
  // with its file identity preserved for the comparison's identity check) is
  // resolved from `figma-source-snapshot`. Absent or unloadable evidence
  // simply yields no reference, which the comparison reports honestly as
  // `unavailable` — never as a match, and never fabricated.
  if ((input.referenceScreenshots ?? []).length === 0) {
    try {
      const snapshot = (await readArtifact(context, "figma-source-snapshot", z.unknown())) as {
        source?: { fileKey?: string; resolvedFrames?: { id?: string }[] };
        screenshots?: { nodeId?: string; artifactId?: string }[];
      };
      const wantedNodeId = input.designIdentity?.nodeId ?? snapshot.source?.resolvedFrames?.[0]?.id;
      const screenshot =
        (snapshot.screenshots ?? []).find((entry) => entry.nodeId === wantedNodeId) ??
        (snapshot.screenshots ?? [])[0];
      if (screenshot?.artifactId !== undefined) {
        const stored = await context.artifactStore.get(screenshot.artifactId);
        if (stored !== null && typeof stored.data === "string") {
          const bytes = new Uint8Array(Buffer.from(stored.data, "base64"));
          const identity = {
            ...(snapshot.source?.fileKey !== undefined ? { fileKey: snapshot.source.fileKey } : {}),
            ...(screenshot.nodeId !== undefined ? { nodeId: screenshot.nodeId } : {}),
            captureMethod: "figma",
          };
          for (const viewport of input.viewports ?? DEFAULT_VISUAL_VIEWPORTS) {
            resolved.push({
              viewportId: viewport.id,
              bytes,
              artifactId: screenshot.artifactId,
              evidenceId: `reference-${screenshot.nodeId ?? "frame"}-${viewport.id}`,
              identity,
            });
          }
        }
      }
    } catch {
      // No snapshot in this run's lineage: standalone V2 stages keep their
      // explicit-input behavior unchanged.
    }
    return resolved;
  }

  for (const reference of input.referenceScreenshots ?? []) {
    const stored = await context.artifactStore.get(reference.artifactId);
    if (stored === null || typeof stored.data !== "string") continue;
    resolved.push({
      viewportId: reference.viewportId,
      bytes: new Uint8Array(Buffer.from(stored.data, "base64")),
      artifactId: reference.artifactId,
      ...(reference.evidenceId !== undefined ? { evidenceId: reference.evidenceId } : {}),
      identity: {
        ...(reference.fileKey !== undefined ? { fileKey: reference.fileKey } : {}),
        ...(reference.nodeId !== undefined ? { nodeId: reference.nodeId } : {}),
        ...(reference.captureMethod !== undefined ? { captureMethod: reference.captureMethod } : {}),
      },
    });
  }

  return resolved;
}

export const renderProposedStateCapability: Capability<unknown, CapabilityOutput> = {
  ...base(
    "render-proposed-state",
    "Render proposed state",
    "Builds and renders the validated proposal in an isolated workspace and persists the result.",
  ),
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = stageInput.parse(raw) as V2VisualStageInput;
    // Parsed after loading rather than through `readArtifact`'s generic, whose
    // inferred type follows the schema's *input* side and would drop defaults.
    const blueprint = uiBlueprintSchema.parse(await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.blueprint, z.unknown()));
    const map = implementationMapSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.implementationMap, z.unknown()),
    );
    const proposal = proposedFileChangesSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.proposal, z.unknown()),
    );

    const inspected = inspectRegisteredProject({
      id: input.project.id,
      name: input.project.name,
      rootPath: input.project.rootPath,
    });
    const project = inspected as unknown as Stage4ProjectImplementationContext;

    const result = await renderProposedState(input.project.rootPath, project, proposal, {
      viewports: input.viewports ?? DEFAULT_VISUAL_VIEWPORTS,
      signal: context.signal,
      implementationMap: map,
      ...(input.instrument !== undefined ? { instrument: input.instrument } : {}),
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(configuredBrowserRenderer(context.config.visualRenderer) !== undefined
        ? { renderer: configuredBrowserRenderer(context.config.visualRenderer)! }
        : {}),
      reference: await resolveReferences(context, input),
      ...(input.designIdentity !== undefined
        ? {
            referenceIdentity: {
              ...(input.designIdentity.fileKey !== undefined ? { fileKey: input.designIdentity.fileKey } : {}),
              ...(input.designIdentity.nodeId !== undefined ? { nodeId: input.designIdentity.nodeId } : {}),
            },
          }
        : {}),
      ...(input.expectedProjectFingerprint !== undefined
        ? { expectedProjectFingerprint: input.expectedProjectFingerprint }
        : {}),
      ...(input.currentProjectFingerprint !== undefined
        ? { currentProjectFingerprint: input.currentProjectFingerprint }
        : {}),
      binding: {
        blueprintArtifactId: V2_VISUAL_ARTIFACT_IDS.blueprint,
        implementationMapArtifactId: V2_VISUAL_ARTIFACT_IDS.implementationMap,
        proposalArtifactId: V2_VISUAL_ARTIFACT_IDS.proposal,
        ...(map.binding.projectFingerprint !== undefined
          ? { projectFingerprint: map.binding.projectFingerprint }
          : {}),
      },
    });

    // Screenshots are content-addressed payloads of their own. The
    // RenderedState references them; it never carries image bytes.
    const viewports = await Promise.all(
      result.renderedState.viewports.map(async (viewport) => {
        const capture = result.captures.find((entry) => entry.viewport.id === viewport.id);
        if (capture === undefined) return viewport;
        const stored = await context.artifactStore.save(Buffer.from(capture.capture.bytes).toString("base64"), {
          type: "implementation.rendered-screenshot",
          sourceType: "proposed-state",
          viewport: viewport.id,
        });
        return { ...viewport, screenshotArtifactId: stored.id };
      }),
    );

    const payload: RenderedState = { ...result.renderedState, viewports };
    void blueprint;

    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.renderedState,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.renderedState,
      name: "Rendered State",
      payload,
      summary: {
        status: payload.status,
        viewportCount: payload.viewports.length,
        elementCount: payload.elements.length,
        buildStatus: payload.runtime.buildStatus,
        instrumented: payload.provenance.renderInstrumentationApplied,
        proposalHash: payload.binding.proposalHash,
        // The isolated render never writes to the registered project.
        projectFilesChanged: false,
      },
    });
  },
};

export const evaluateVisualDeltaCapability: Capability<unknown, CapabilityOutput> = {
  ...base(
    "evaluate-visual-delta",
    "Evaluate visual delta",
    "Compares the rendered state against the Blueprint and persists the visual delta report.",
  ),
  async execute(context, raw): Promise<CapabilityOutput> {
    stageInput.parse(raw) as V2VisualStageInput;
    const blueprint = uiBlueprintSchema.parse(await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.blueprint, z.unknown()));
    const map = implementationMapSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.implementationMap, z.unknown()),
    );
    const renderedState = (await readArtifact(
      context,
      V2_VISUAL_ARTIFACT_IDS.renderedState,
      z.unknown(),
    )) as RenderedState;

    const evaluator = configuredVisualEvaluator(context.config.visualEvaluator);
    if (evaluator === undefined)
      throw new DesignFlowError(
        "ERR_VISUAL_EVALUATOR_UNAVAILABLE",
        "No visual evaluator was configured for the V2 visual stage.",
        { capabilityId: context.capabilityId },
      );

    const { report } = await evaluator({ renderedState, blueprint, implementationMap: map });
    const payload = visualDeltaReportSchema.parse(report);

    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.report,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.report,
      name: "Visual Delta Report",
      payload,
      summary: {
        outcome: payload.outcome,
        findingCount: payload.findings.length,
        deterministicFindingCount: payload.findings.filter((finding) => finding.origin === "deterministic").length,
        criticStatus: payload.critic.status,
        matchedElements: payload.correspondence.matched,
        ambiguousElements: payload.correspondence.ambiguous,
        renderedStateArtifactId: V2_VISUAL_ARTIFACT_IDS.renderedState,
        blueprintArtifactId: V2_VISUAL_ARTIFACT_IDS.blueprint,
        implementationMapArtifactId: V2_VISUAL_ARTIFACT_IDS.implementationMap,
        projectFilesChanged: false,
      },
    });
  },
};

export const v2VisualCapabilities: readonly Capability<unknown, CapabilityOutput>[] = [
  storeUIBlueprintCapability,
  storeProjectContextCapability,
  storeImplementationMapCapability,
  storeBuilderProposalCapability,
  renderProposedStateCapability,
  evaluateVisualDeltaCapability,
];
