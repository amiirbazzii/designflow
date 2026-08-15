// apps/designflow-cli/src/services/v2-composition.ts
//
// Production wiring for the V2 flagship seams (V2-8).
//
// The workflow package depends on the SDK alone, so every V2 stage that
// lives elsewhere arrives through `context.config`. This module builds those
// functions from the real packages: the deterministic Blueprint compiler and
// the Project Context compiler run always; the four AI roles — Design
// Interpreter, Project Mapper, UI Builder (initial + visual_repair) and
// Visual Critic — invoke their registered specialized agents through the
// shared `AgentInvocationRuntime`, with the same tracing, budgets and
// managed-gateway model routing as every other agent in this host.
//
// No legacy specialist appears anywhere in this file, and none of these
// drivers can fall back to one: an unavailable Mapper or Builder is a typed
// refusal, never a detour through the old architecture.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentInvocationRuntime,
  DESIGN_INTERPRETER_AGENT_ID,
  PROJECT_MAPPER_AGENT_ID,
  UI_BUILDER_AGENT_ID,
  VISUAL_CRITIC_AGENT_ID,
  applyProjectMappingPatches,
  applySemanticPatches,
  buildImplementation,
  compileImplementationMapDraft,
  compileMappingEvidence,
  compileUIBlueprintDraft,
  evaluateRenderedState,
  partitionBlueprintForEnrichment,
  partitionMappingDraft,
  selectBuilderSourcePaths,
  type BuilderSourceExcerpt,
} from "@designflow/agents";
import { compileProjectContext } from "@designflow/tools";
import { inspectRegisteredProject, projectFileHash, validateProposedModules } from "@designflow/workflow-design-to-code";
import {
  canonicalProjectContextSchema,
  figmaSourceSnapshotSchema,
  type CanonicalProjectContext,
  type ImplementationMap,
  type ProposedFileChanges,
  type UIBlueprint,
} from "@designflow/sdk";

interface ProjectRef {
  readonly id: string;
  readonly name: string;
  readonly rootPath: string;
}

export interface V2CompositionOptions {
  /** The shared invocation runtime; absent means deterministic-only mode. */
  readonly runtime: AgentInvocationRuntime | undefined;
  /** Whether a model provider is configured at all. */
  readonly modelModeRequested: boolean;
}

async function invokeAgent(runtime: AgentInvocationRuntime, agentId: string, input: unknown): Promise<unknown> {
  const outcome = await runtime.invoke({
    agentId,
    attempt: 1,
    objective: `V2 flagship invocation of ${agentId}`,
    input,
  });
  if (outcome.type !== "success") {
    throw Object.assign(new Error(`${agentId}: ${outcome.message}`), { code: outcome.code });
  }
  return outcome.output;
}

function readSourceExcerpts(root: string, map: ImplementationMap): readonly BuilderSourceExcerpt[] {
  const excerpts: BuilderSourceExcerpt[] = [];
  for (const entry of selectBuilderSourcePaths(map)) {
    try {
      const content = readFileSync(join(root, entry.path), "utf8");
      excerpts.push({ path: entry.path, content, hash: createHash("sha256").update(content).digest("hex") });
    } catch {
      // A planned-but-absent file is simply not shown; create targets have none.
    }
  }
  return excerpts;
}

function builderRunner(options: {
  readonly runtime: AgentInvocationRuntime;
  readonly blueprint: UIBlueprint;
  readonly map: ImplementationMap;
  readonly context: CanonicalProjectContext;
  readonly project: ProjectRef;
  readonly mode: "initial" | "visual_repair";
  readonly visualRepairEvidence?: unknown;
}) {
  const inspected = inspectRegisteredProject(options.project);
  const baseProjectFingerprint = inspected.project.contextFingerprint;
  const buildCommand = inspected.commands.build;

  return buildImplementation({
    blueprint: options.blueprint,
    map: options.map,
    context: options.context,
    projectId: options.project.id,
    baseProjectFingerprint,
    mode: options.mode,
    ...(options.visualRepairEvidence !== undefined ? { visualRepairEvidence: options.visualRepairEvidence } : {}),
    sourceExcerpts: readSourceExcerpts(options.project.rootPath, options.map),
    generate: async (evidence, attempt) => {
      const proposal = (await invokeAgent(options.runtime, UI_BUILDER_AGENT_ID, {
        evidence,
        projectId: options.project.id,
        baseProjectFingerprint,
        attempt,
      })) as ProposedFileChanges;
      // The snapshot/apply integrity gates require each modified file to name
      // the exact base it was proposed against; the host stamps it from disk —
      // never from anything the model said.
      return {
        ...proposal,
        files: proposal.files.map((file) => {
          if (file.action !== "modify" || file.expectedBaseHash !== undefined) return file;
          const hash = projectFileHash(join(options.project.rootPath, file.path));
          return hash === undefined ? file : { ...file, expectedBaseHash: hash };
        }),
      };
    },
    validateProposedState: async (proposal) => {
      const result = await validateProposedModules(options.project.rootPath, proposal, {
        ...(buildCommand !== undefined
          ? { buildCommand: { executable: buildCommand.executable, args: buildCommand.args ?? [] } }
          : {}),
      });
      return { status: result.status, diagnostics: result.diagnostics.map((entry) => entry.message) };
    },
  });
}

/** The `context.config` entries the flagship V2 workflow consumes. */
export function createV2CapabilityConfig(options: V2CompositionOptions): Record<string, unknown> {
  const { runtime, modelModeRequested } = options;
  const modelMode = modelModeRequested && runtime !== undefined;

  return {
    v2BlueprintCompiler: async ({ snapshot, snapshotArtifactId }: { snapshot: unknown; snapshotArtifactId: string }) => {
      const parsed = figmaSourceSnapshotSchema.parse(snapshot);
      const draft = compileUIBlueprintDraft(parsed, { snapshotArtifactId });
      if (!modelMode) return { blueprint: draft, semanticStatus: "not_requested" as const };

      // Semantic enrichment is additive (§13): an unavailable Design
      // Interpreter leaves the deterministic Blueprint fully usable.
      try {
        const partitions = partitionBlueprintForEnrichment(draft);
        const patches: unknown[] = [];
        for (const partition of partitions)
          patches.push(await invokeAgent(runtime!, DESIGN_INTERPRETER_AGENT_ID, { partition }));
        return {
          blueprint: applySemanticPatches(draft, patches, { partitionCount: partitions.length }),
          semanticStatus: "enriched" as const,
        };
      } catch {
        return { blueprint: draft, semanticStatus: "unavailable" as const };
      }
    },

    v2ProjectContextCompiler: async ({ project }: { project: ProjectRef }) => {
      const inspected = inspectRegisteredProject(project);
      return {
        context: compileProjectContext({
          root: project.rootPath,
          projectId: project.id,
          implementationContext: inspected,
        }),
      };
    },

    v2ProjectMapper: async ({
      blueprint,
      projectContext,
      project,
    }: {
      blueprint: UIBlueprint;
      projectContext: unknown;
      project: ProjectRef;
    }) => {
      // Required role (§14): no model means no plan — and never the legacy
      // Implementation Agent.
      if (!modelMode)
        return { status: "unavailable" as const, reason: "no model provider is configured for the Project Mapper" };
      try {
        const context = canonicalProjectContextSchema.parse(projectContext);
        const draft = compileImplementationMapDraft(blueprint, context, {
          blueprintArtifactId: "ui-blueprint",
          projectContextArtifactId: "project-context",
        });
        const partitions = partitionMappingDraft(draft);
        const patches: unknown[] = [];
        for (const partition of partitions)
          patches.push(
            await invokeAgent(runtime!, PROJECT_MAPPER_AGENT_ID, {
              evidence: compileMappingEvidence(partition, draft, blueprint, context),
            }),
          );
        const map = applyProjectMappingPatches(draft, patches, { partitionCount: partitions.length });
        void project;
        return { status: "complete" as const, map };
      } catch (error) {
        return { status: "failed" as const, reason: error instanceof Error ? error.message.slice(0, 300) : "mapping failed" };
      }
    },

    v2UiBuilder: async ({
      blueprint,
      map,
      projectContext,
      project,
    }: {
      blueprint: UIBlueprint;
      map: ImplementationMap;
      projectContext: unknown;
      project: ProjectRef;
    }) => {
      if (!modelMode)
        return { status: "unavailable" as const, attempts: 0, reason: "no model provider is configured for the UI Builder" };
      return builderRunner({
        runtime: runtime!,
        blueprint,
        map,
        context: canonicalProjectContextSchema.parse(projectContext),
        project,
        mode: "initial",
      });
    },

    visualRepairBuilder: async (input: {
      blueprint: UIBlueprint;
      implementationMap: ImplementationMap;
      repairEvidence: unknown;
      project?: ProjectRef;
      projectContext?: unknown;
    }) => {
      if (!modelMode || input.project === undefined || input.projectContext === undefined)
        return { status: "unavailable" as const, attempts: 0, reason: "no repair Builder is configured" };
      return builderRunner({
        runtime: runtime!,
        blueprint: input.blueprint,
        map: input.implementationMap,
        context: canonicalProjectContextSchema.parse(input.projectContext),
        project: input.project,
        mode: "visual_repair",
        visualRepairEvidence: input.repairEvidence,
      });
    },

    visualEvaluator: async (input: Parameters<typeof evaluateRenderedState>[0]) =>
      evaluateRenderedState({
        ...input,
        // The Critic is advisory (§16): wired only when a model exists, and a
        // failed critic call already degrades honestly inside the evaluator.
        ...(modelMode
          ? {
              critic: async (evidence: unknown, partition: { partitionId: string }) =>
                invokeAgent(runtime!, VISUAL_CRITIC_AGENT_ID, { evidence, partitionId: partition.partitionId }),
            }
          : {}),
      }),
  };
}
