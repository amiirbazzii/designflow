// workflows/workflow-design-to-code/src/flagship/flagship-capabilities.ts
//
// The flagship-only deterministic steps (V2-8).
//
// Everything here is glue with authority: read the canonical artifact the
// previous stage produced, call the injected V2 stage, enforce the user's
// decisions, persist the canonical artifact the next stage reads. The stages
// themselves — Blueprint compiler, Project Mapper, UI Builder, visual
// pipeline — keep their own semantics in their own modules; nothing is
// duplicated here to "match the numbering".
//
// Failure is honest and typed. Mapper unavailable is a product failure, not a
// silent fall back to the legacy Implementation Agent; a convergence outcome
// the eligibility policy rejects never reaches approval.
import { z } from "zod";
import {
  DesignFlowError,
  VISUAL_CONVERGENCE_ARTIFACT_ID,
  implementationMapSchema,
  proposedFileChangesSchema,
  uiBlueprintSchema,
  visualConvergenceArtifactSchema,
  type Capability,
  type ImplementationMap,
  type VisualConvergenceStatus,
} from "@designflow/sdk";

import { readArtifact, writeArtifact } from "../orchestration/artifact-io";
import { capabilityOutputSchema, type CapabilityOutput } from "../orchestration/types";
import { V2_VISUAL_ARTIFACT_IDS, V2_VISUAL_ARTIFACT_TYPES } from "../v2-visual/v2-visual-types";
import type { implementationDestinationSchema } from "../implementation/implementation-types";
import {
  configuredBlueprintCompiler,
  configuredProjectContextCompiler,
  configuredProjectMapper,
  configuredUiBuilder,
  flagshipInputSchema,
} from "./flagship-types";

const FIGMA_SNAPSHOT_ARTIFACT_ID = "figma-source-snapshot";

function unavailable(code: string, message: string, metadata?: Record<string, unknown>): never {
  throw new DesignFlowError(code, message, metadata);
}

// ── Blueprint ───────────────────────────────────────────────────

export const compileV2BlueprintCapability: Capability<unknown, CapabilityOutput> = {
  id: "compile-v2-blueprint",
  name: "Compile UI Blueprint",
  description: "Compiles the canonical UI Blueprint from the acquired Figma evidence.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    flagshipInputSchema.parse(raw);
    const compiler = configuredBlueprintCompiler(context.config.v2BlueprintCompiler);
    if (compiler === undefined)
      unavailable("ERR_V2_BLUEPRINT_COMPILER_UNAVAILABLE", "No V2 Blueprint compiler was configured.");

    const snapshot = await readArtifact(context, FIGMA_SNAPSHOT_ARTIFACT_ID, z.unknown());
    const compiled = await compiler({ snapshot, snapshotArtifactId: FIGMA_SNAPSHOT_ARTIFACT_ID });
    const blueprint = uiBlueprintSchema.parse(compiled.blueprint);

    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.blueprint,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.blueprint,
      name: "UI Blueprint",
      payload: blueprint,
      summary: {
        elementCount: blueprint.elements.length,
        componentCount: blueprint.components.length,
        // Semantic enrichment is additive; its honest status is recorded, and
        // an unavailable Design Interpreter never fails the flagship (§13).
        semanticStatus: compiled.semanticStatus,
        projectFilesChanged: false,
      },
    });
  },
};

// ── Project Context ─────────────────────────────────────────────

export const compileV2ProjectContextCapability: Capability<unknown, CapabilityOutput> = {
  id: "compile-v2-project-context",
  name: "Compile Project Context",
  description: "Compiles the canonical Project Context for the registered project.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = flagshipInputSchema.parse(raw);
    const compiler = configuredProjectContextCompiler(context.config.v2ProjectContextCompiler);
    if (compiler === undefined)
      unavailable("ERR_V2_PROJECT_CONTEXT_UNAVAILABLE", "No V2 Project Context compiler was configured.");

    const compiled = await compiler({ project: input.project });

    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.projectContext,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.projectContext,
      name: "Project Context",
      payload: compiled.context ?? {},
      summary: { projectId: input.project.id, projectFilesChanged: false },
    });
  },
};

// ── Project Mapper + destination binding ───────────────────────

type Destination = z.infer<typeof implementationDestinationSchema>;

function normalizePath(path: string): string {
  return path.replace(/^\.?\//, "").replace(/\/+$/, "");
}

/**
 * The user's destination decision is authority, not advice (§7, §8).
 *
 * The Mapper may reason about how to realize the destination; it may not
 * contradict it. Deterministic comparison: when the product selection names a
 * path, the map's screen destination must be that path or live under it; when
 * it names an existing source file, the plan must target that file.
 */
export function validateDestinationBinding(
  destination: Destination,
  map: ImplementationMap,
): string | undefined {
  const planned = map.screen?.destination.path;

  if (destination.path !== undefined) {
    if (planned === undefined) return `The user chose ${destination.path}, but the plan names no screen destination.`;
    const chosen = normalizePath(destination.path);
    const mapped = normalizePath(planned);
    if (mapped !== chosen && !mapped.startsWith(`${chosen}/`))
      return `The user chose ${destination.path}, but the plan targets ${planned}.`;
  }

  if (destination.sourcePath !== undefined) {
    const source = normalizePath(destination.sourcePath);
    const touchesSource =
      (planned !== undefined && normalizePath(planned) === source) ||
      map.screen?.compositionRootPath !== undefined && normalizePath(map.screen.compositionRootPath) === source ||
      map.components.some(
        (component) =>
          (component.projectTarget !== undefined && normalizePath(component.projectTarget.path) === source) ||
          (component.plannedPath !== undefined && normalizePath(component.plannedPath) === source),
      );
    if (!touchesSource)
      return `The user chose the existing ${destination.sourcePath}, but the plan never targets it.`;
  }

  return undefined;
}

export const mapV2ProjectCapability: Capability<unknown, CapabilityOutput> = {
  id: "map-v2-project",
  name: "Map design to project",
  description: "Runs the Project Mapper and enforces the user's destination decision.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = flagshipInputSchema.parse(raw);
    const mapper = configuredProjectMapper(context.config.v2ProjectMapper);
    if (mapper === undefined)
      unavailable(
        "ERR_PROJECT_MAPPER_UNAVAILABLE",
        "Implementation could not be safely planned: the Project Mapper is unavailable. No files were changed.",
      );

    const blueprint = uiBlueprintSchema.parse(await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.blueprint, z.unknown()));
    const projectContext = await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.projectContext, z.unknown());

    const result = await mapper({ blueprint, projectContext, destination: input.destination, project: input.project });
    // Mapper unavailability is a typed product failure — never a silent fall
    // back to the legacy Implementation Agent (§14, §24).
    if (result.status !== "complete" || result.map === undefined)
      unavailable(
        "ERR_PROJECT_MAPPER_UNAVAILABLE",
        `Implementation could not be safely planned${result.reason !== undefined ? `: ${result.reason}` : ""}. No files were changed.`,
      );

    const map = implementationMapSchema.parse(result.map);
    const mismatch = validateDestinationBinding(input.destination, map);
    if (mismatch !== undefined)
      unavailable("ERR_DESTINATION_BINDING_MISMATCH", `${mismatch} The user's destination decision is binding.`, {
        destination: input.destination.label,
      });

    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.implementationMap,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.implementationMap,
      name: "Implementation Map",
      payload: map,
      summary: {
        componentCount: map.components.length,
        destination: input.destination.label,
        projectFilesChanged: false,
      },
    });
  },
};

// ── UI Builder (initial) ───────────────────────────────────────

export const buildV2ImplementationCapability: Capability<unknown, CapabilityOutput> = {
  id: "build-v2-implementation",
  name: "Build implementation",
  description: "Runs the UI Builder against the immutable Implementation Map.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = flagshipInputSchema.parse(raw);
    const builder = configuredUiBuilder(context.config.v2UiBuilder);
    if (builder === undefined)
      unavailable("ERR_UI_BUILDER_UNAVAILABLE", "The UI Builder is unavailable. No files were changed.");

    const blueprint = uiBlueprintSchema.parse(await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.blueprint, z.unknown()));
    const map = implementationMapSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.implementationMap, z.unknown()),
    );
    const projectContext = await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.projectContext, z.unknown());

    const result = await builder({ blueprint, map, projectContext, project: input.project });
    if (result.status !== "valid" || result.proposal === undefined) {
      // Honest, typed, and never the legacy Implementation Agent (§15, §24).
      const code =
        result.status === "map_unexecutable"
          ? "ERR_IMPLEMENTATION_MAP_UNEXECUTABLE"
          : result.status === "stale_project"
            ? "ERR_PROJECT_CHANGED"
            : result.status === "unavailable"
              ? "ERR_UI_BUILDER_UNAVAILABLE"
              : "ERR_UI_BUILDER_EXHAUSTED";
      unavailable(code, `${result.reason ?? "The UI Builder produced no valid proposal."} No files were changed.`);
    }

    const proposal = proposedFileChangesSchema.parse(result.proposal);
    return writeArtifact(context, {
      artifactId: V2_VISUAL_ARTIFACT_IDS.proposal,
      artifactType: V2_VISUAL_ARTIFACT_TYPES.proposal,
      name: "Builder Proposal",
      payload: proposal,
      summary: {
        fileCount: proposal.files.length,
        builderAttempts: result.attempts,
        projectFilesChanged: false,
      },
    });
  },
};

// ── Convergence eligibility (§17, §18) ──────────────────────────

/** The one deterministic finalization-eligibility policy for the flagship. */
export const FINALIZABLE_CONVERGENCE_STATUSES: readonly VisualConvergenceStatus[] = [
  "converged",
  "converged_with_findings",
];

export function isConvergenceFinalizable(status: VisualConvergenceStatus): boolean {
  return FINALIZABLE_CONVERGENCE_STATUSES.includes(status);
}

const NOT_FINALIZABLE_MESSAGES: Partial<Record<VisualConvergenceStatus, string>> = {
  inconclusive:
    "Visual verification inconclusive: the implementation built, but DesignFlow could not verify the rendered result. No files were changed.",
  exhausted:
    "Visual refinement did not reach an acceptable result within its budget. No files were changed.",
  render_failed: "The implementation could not be rendered for verification. No files were changed.",
  builder_failed: "The UI Builder produced no valid repair. No files were changed.",
  map_unexecutable: "The implementation plan could not be executed. No files were changed.",
  project_changed: "The project changed while DesignFlow was working. No files were changed.",
  repair_required: "Visual refinement is required but no repair path was available. No files were changed.",
  cancelled: "The run was cancelled. No files were changed.",
};

export const assertV2FinalizableCapability: Capability<unknown, CapabilityOutput> = {
  id: "assert-v2-finalizable",
  name: "Check visual result",
  description: "Applies the deterministic finalization-eligibility policy to the convergence outcome.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    flagshipInputSchema.parse(raw);
    const convergence = visualConvergenceArtifactSchema.parse(
      await readArtifact(context, VISUAL_CONVERGENCE_ARTIFACT_ID, visualConvergenceArtifactSchema),
    );

    // No silent visual bypass: an outcome the policy cannot classify as safe
    // never reaches approval (§18).
    if (!isConvergenceFinalizable(convergence.status))
      unavailable(
        "ERR_VISUAL_RESULT_NOT_FINALIZABLE",
        NOT_FINALIZABLE_MESSAGES[convergence.status] ??
          `The visual result (${convergence.status}) is not eligible for approval. No files were changed.`,
        { convergenceStatus: convergence.status },
      );

    return writeArtifact(context, {
      artifactId: "v2-finalization-eligibility",
      artifactType: "implementation.finalization-eligibility",
      name: "Finalization eligibility",
      payload: {
        schemaVersion: "1",
        convergenceStatus: convergence.status,
        finalizable: true,
        selectedIteration: convergence.selectedIteration ?? null,
      },
      summary: { convergenceStatus: convergence.status, projectFilesChanged: false },
    });
  },
};

export const flagshipCapabilities = [
  compileV2BlueprintCapability,
  compileV2ProjectContextCapability,
  mapV2ProjectCapability,
  buildV2ImplementationCapability,
  assertV2FinalizableCapability,
];
