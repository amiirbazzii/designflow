// workflows/workflow-design-to-code/src/visual-convergence/visual-convergence-capability.ts
//
// The bounded convergence loop, executable (V2-6).
//
//   render P0 → report R0 → repair? → Builder P1 → render P1 from scratch → R1
//                                   → Builder P2 → render P2 from scratch → R2
//   → deterministic candidate selection → implementation.visual-convergence
//
// The host owns iteration. The Builder and the evaluator arrive injected
// through `context.config` (`visualRepairBuilder`, `visualEvaluator`) — this
// package never imports the agents package, and the legacy Visual Correction
// agent is not part of this loop at all. Nothing here applies files, requests
// approval, or writes to the registered project: every render happens in a
// fresh isolated workspace, and the run ends at a persisted record naming one
// selected proposal for the future approval stage.
import { z } from "zod";
import {
  DesignFlowError,
  canonicalProposalHash,
  verifyProjectProposalBinding,
  VISUAL_CONVERGENCE_LIMITS,
  implementationMapSchema,
  proposedFileChangesSchema,
  uiBlueprintSchema,
  visualConvergenceArtifactSchema,
  visualDeltaReportSchema,
  type Capability,
  type CapabilityContext,
  type ConvergenceIteration,
  type ImplementationMap,
  type ProposedFileChanges,
  type RenderedState,
  type Stage4ProjectImplementationContext,
  type UIBlueprint,
  type VisualConvergenceStatus,
  type VisualConvergenceStopReason,
  type VisualDeltaReport,
} from "@designflow/sdk";
import { inspectRegisteredProject } from "@designflow/capability-implementation";

import { readArtifact, writeArtifact } from "../orchestration/artifact-io";
import { configuredBrowserRenderer, DEFAULT_VISUAL_VIEWPORTS } from "../visual-validation/visual-validation-runtime";
import { renderProposedState } from "../visual-validation/render-proposed-state";
import { V2_VISUAL_ARTIFACT_IDS } from "../v2-visual/v2-visual-types";
import { configuredVisualEvaluator, resolveReferences } from "../v2-visual/v2-visual-capabilities";
import {
  V2_CONVERGENCE_ARTIFACT_IDS,
  V2_CONVERGENCE_ARTIFACT_TYPES,
  configuredVisualRepairBuilder,
  v2ConvergenceInputLoose,
  type V2ConvergenceInput,
} from "./visual-convergence-types";
import { acceptanceStatus, deriveIterationQuality, evidenceUsable } from "./convergence-policy";
import { compareReports } from "./finding-comparison";
import { compileVisualRepairEvidence } from "./repair-evidence";
import { SELECTION_POLICY_VERSION, selectBestCandidate } from "./candidate-selection";

const outputSchema = z
  .object({
    artifactRef: z.object({ id: z.string(), type: z.string(), metadata: z.record(z.unknown()) }).strict(),
  })
  .strict();

type CapabilityOutput = z.infer<typeof outputSchema>;

function proposalHashOf(proposal: ProposedFileChanges): string {
  return canonicalProposalHash(proposal);
}

interface RenderedIteration {
  readonly renderedState: RenderedState;
  readonly renderedStateRef: string;
}

/** Renders one proposal from scratch and persists the result as its own payload. */
async function renderIteration(
  context: CapabilityContext,
  input: V2ConvergenceInput,
  project: Stage4ProjectImplementationContext,
  map: ImplementationMap,
  proposal: ProposedFileChanges,
  iteration: number,
): Promise<RenderedIteration> {
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
    binding: {
      blueprintArtifactId: V2_VISUAL_ARTIFACT_IDS.blueprint,
      implementationMapArtifactId: V2_VISUAL_ARTIFACT_IDS.implementationMap,
      proposalArtifactId: iteration === 0 ? V2_VISUAL_ARTIFACT_IDS.proposal : `${V2_VISUAL_ARTIFACT_IDS.proposal}-${iteration}`,
      ...(map.binding.projectFingerprint !== undefined ? { projectFingerprint: map.binding.projectFingerprint } : {}),
    },
  });

  // Fresh screenshots become fresh payloads every iteration; the RenderedState
  // references them and never carries image bytes.
  const viewports = await Promise.all(
    result.renderedState.viewports.map(async (viewport) => {
      const capture = result.captures.find((entry) => entry.viewport.id === viewport.id);
      if (capture === undefined) return viewport;
      const stored = await context.artifactStore.save(Buffer.from(capture.capture.bytes).toString("base64"), {
        type: "implementation.rendered-screenshot",
        sourceType: "proposed-state",
        viewport: viewport.id,
        convergenceIteration: iteration,
      });
      return { ...viewport, screenshotArtifactId: stored.id };
    }),
  );

  const renderedState: RenderedState = { ...result.renderedState, viewports };
  const stored = await context.artifactStore.save(renderedState, {
    type: "implementation.rendered-state",
    convergenceIteration: iteration,
    proposalHash: renderedState.binding.proposalHash,
  });

  return { renderedState, renderedStateRef: stored.id };
}

/** Non-`rendered` render outcomes, translated into the typed stop vocabulary. */
function renderStop(status: RenderedState["status"]): {
  readonly status: VisualConvergenceStatus;
  readonly stopReason: VisualConvergenceStopReason;
} {
  switch (status) {
    case "browser_unavailable":
      return { status: "inconclusive", stopReason: "render_inconclusive" };
    case "project_changed_before_render":
      return { status: "project_changed", stopReason: "project_changed" };
    case "cancelled":
      return { status: "cancelled", stopReason: "cancelled" };
    default:
      return { status: "render_failed", stopReason: "render_failed" };
  }
}

export const runVisualConvergenceCapability: Capability<unknown, CapabilityOutput> = {
  id: "run-visual-convergence",
  name: "Run visual convergence",
  description: "Runs the bounded pre-approval render→evaluate→repair loop and persists the convergence record.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = v2ConvergenceInputLoose.parse(raw) as V2ConvergenceInput;
    const blueprint: UIBlueprint = uiBlueprintSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.blueprint, z.unknown()),
    );
    const map = implementationMapSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.implementationMap, z.unknown()),
    );
    const initialProposal = proposedFileChangesSchema.parse(
      await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.proposal, z.unknown()),
    );

    const evaluator = configuredVisualEvaluator(context.config.visualEvaluator);
    if (evaluator === undefined)
      throw new DesignFlowError(
        "ERR_VISUAL_EVALUATOR_UNAVAILABLE",
        "No visual evaluator was configured for the V2 convergence stage.",
        { capabilityId: context.capabilityId },
      );
    const repairBuilder = configuredVisualRepairBuilder(context.config.visualRepairBuilder);

    // The canonical budget. Configuration can lower it; nothing can raise it —
    // the deterministic host enforces the hard ceiling even against malformed
    // input, and the schema clamp above already rejected anything larger.
    const limit = Math.max(
      1,
      Math.min(
        input.maxEvaluatedStates ?? VISUAL_CONVERGENCE_LIMITS.defaultEvaluatedStates,
        VISUAL_CONVERGENCE_LIMITS.hardMaxEvaluatedStates,
      ),
    );

    const inspect = () =>
      inspectRegisteredProject({ id: input.project.id, name: input.project.name, rootPath: input.project.rootPath });
    const initial = inspect();
    const project = initial as unknown as Stage4ProjectImplementationContext;
    const initialFingerprint = (initial as { project: { contextFingerprint?: string } }).project.contextFingerprint;
    const baseProjectFingerprint = initialProposal.baseProjectFingerprint;

    const iterations: ConvergenceIteration[] = [];
    const reports: VisualDeltaReport[] = [];
    const notes: string[] = [];
    let currentProposal = initialProposal;
    let currentProposalRef: string = V2_VISUAL_ARTIFACT_IDS.proposal;
    /** Builder attempts spent producing the proposal about to be rendered. */
    let pendingBuilderAttempts = 0;
    let status: VisualConvergenceStatus | undefined;
    let stopReason: VisualConvergenceStopReason | undefined;

    for (let iteration = 0; iteration < limit; iteration += 1) {
      if (context.signal.aborted) {
        status = "cancelled";
        stopReason = "cancelled";
        break;
      }

      // Project drift is re-checked at every iteration boundary with the same
      // inspection the initial fingerprint came from — no new fingerprint
      // implementation, per the pre-V2-7 consolidation constraint.
      if (iteration > 0) {
        const current = (inspect() as { project: { contextFingerprint?: string } }).project.contextFingerprint;
        if (initialFingerprint !== undefined && current !== undefined && current !== initialFingerprint) {
          status = "project_changed";
          stopReason = "project_changed";
          notes.push("PROJECT_CHANGED_DURING_REFINEMENT: the registered project changed mid-convergence.");
          break;
        }
      }

      const { renderedState, renderedStateRef } = await renderIteration(
        context,
        input,
        project,
        map,
        currentProposal,
        iteration,
      );

      if (renderedState.status !== "rendered") {
        const stop = renderStop(renderedState.status);
        status = stop.status;
        stopReason = stop.stopReason;
        notes.push(`Iteration ${iteration} did not render: ${renderedState.status}.`);
        break;
      }

      const { report } = await evaluator({ renderedState, blueprint, implementationMap: map });
      const parsedReport = visualDeltaReportSchema.parse(report);
      const reportStored = await context.artifactStore.save(parsedReport, {
        type: "implementation.visual-delta-report",
        convergenceIteration: iteration,
        proposalHash: renderedState.binding.proposalHash,
      });
      reports.push(parsedReport);

      const previousReport = reports.at(-2);
      const comparison = previousReport === undefined ? undefined : compareReports(previousReport, parsedReport);

      iterations.push({
        iteration,
        proposalHash: renderedState.binding.proposalHash,
        ...(iterations.length > 0 ? { repairsProposalHash: iterations.at(-1)!.proposalHash } : {}),
        proposalRef: currentProposalRef,
        renderedStateRef,
        reportRef: reportStored.id,
        outcome: parsedReport.outcome,
        quality: deriveIterationQuality(parsedReport, renderedState),
        ...(comparison !== undefined ? { comparison } : {}),
        builderAttempts: pendingBuilderAttempts,
      });

      if (!evidenceUsable(renderedState, parsedReport)) {
        status = "inconclusive";
        stopReason = "render_inconclusive";
        notes.push(`Iteration ${iteration} produced unusable visual evidence; no repair was attempted on a guess.`);
        break;
      }

      const acceptance = acceptanceStatus(parsedReport);
      if (acceptance !== "repair_required") {
        status = acceptance;
        stopReason = acceptance === "converged" ? "converged" : "acceptable_with_findings";
        break;
      }

      if (comparison !== undefined && comparison.verdict === "no_measurable_improvement") {
        status = "exhausted";
        stopReason = "no_measurable_improvement";
        notes.push("NO_MEASURABLE_IMPROVEMENT: the repair changed nothing the deterministic comparison can see.");
        break;
      }
      if (comparison !== undefined && comparison.verdict === "regressed") {
        status = "exhausted";
        stopReason = "regression_detected";
        notes.push("The repair regressed overall quality; deterministic selection will prefer a prior candidate.");
        break;
      }

      if (iteration === limit - 1) {
        status = "exhausted";
        stopReason = "iteration_limit_reached";
        break;
      }

      // ── One bounded repair ────────────────────────────────────
      if (repairBuilder === undefined) {
        status = "repair_required";
        stopReason = "builder_exhausted";
        notes.push("Refinement is required but no repair Builder was configured; stopping honestly.");
        break;
      }

      const repairEvidence = compileVisualRepairEvidence({
        report: parsedReport,
        map,
        blueprint,
        correspondences: renderedState.correspondences,
      });

      const projectContext = await readArtifact(context, V2_VISUAL_ARTIFACT_IDS.projectContext, z.unknown()).catch(
        () => undefined,
      );
      const built = await repairBuilder({
        blueprint,
        implementationMap: map,
        previousProposal: currentProposal,
        repairEvidence,
        repairNumber: iteration + 1,
        project: input.project,
        ...(projectContext !== undefined ? { projectContext } : {}),
      });

      if (built.status !== "valid" || built.proposal === undefined) {
        status = built.status === "map_unexecutable" ? "map_unexecutable" : "builder_failed";
        stopReason = built.status === "map_unexecutable" ? "map_unexecutable" : "builder_exhausted";
        notes.push(`Repair ${iteration + 1} produced no valid proposal: ${built.reason ?? built.status}.`);
        break;
      }

      const repaired = proposedFileChangesSchema.parse(built.proposal);

      // Every proposal must remain independently applicable to the original
      // base — nothing has been applied, and a proposal that assumes its
      // predecessor's files exist would be un-approvable.
      if (
        !verifyProjectProposalBinding({
          expectedProjectFingerprint: baseProjectFingerprint,
          actualProjectFingerprint: repaired.baseProjectFingerprint,
        }).ok
      ) {
        status = "builder_failed";
        stopReason = "builder_exhausted";
        notes.push("The repair proposal is not bound to the original project base and was refused.");
        break;
      }

      if (proposalHashOf(repaired) === proposalHashOf(currentProposal)) {
        status = "exhausted";
        stopReason = "no_measurable_improvement";
        notes.push("The repair returned a byte-identical proposal; re-rendering it would prove nothing.");
        break;
      }

      const proposalStored = await context.artifactStore.save(repaired, {
        type: "implementation.builder-proposal",
        convergenceIteration: iteration + 1,
        repairs: renderedState.binding.proposalHash,
      });
      currentProposal = repaired;
      currentProposalRef = proposalStored.id;
      pendingBuilderAttempts = built.attempts;
    }

    const selected = selectBestCandidate(iterations);
    const first = reports.at(0);
    const last = reports.at(-1);
    const comparisons = iterations.map((entry) => entry.comparison).filter((entry) => entry !== undefined);

    const payload = visualConvergenceArtifactSchema.parse({
      schemaVersion: "1",
      status: status ?? "exhausted",
      stopReason: stopReason ?? "iteration_limit_reached",
      iterationLimit: limit,
      iterationsPerformed: iterations.length,
      iterations,
      ...(selected !== undefined
        ? {
            selectedIteration: selected.iteration,
            selectedProposalRef: selected.proposalRef,
            selectedProposalHash: selected.proposalHash,
            selectedRenderedStateRef: selected.renderedStateRef,
            selectedVisualDeltaReportRef: selected.reportRef,
          }
        : {}),
      selectionPolicyVersion: SELECTION_POLICY_VERSION,
      ...(baseProjectFingerprint !== undefined ? { baseProjectFingerprint } : {}),
      metrics: {
        visualConvergenceIterationCount: iterations.length,
        visualConvergenceRepairCount: Math.max(0, iterations.length - 1),
        visualConvergenceInitialFindingCount: first?.findings.length ?? 0,
        visualConvergenceFinalFindingCount: last?.findings.length ?? 0,
        visualConvergenceResolvedCount: comparisons.reduce((sum, entry) => sum + entry!.resolved, 0),
        visualConvergenceImprovedCount: comparisons.reduce((sum, entry) => sum + entry!.improved, 0),
        visualConvergenceRegressedCount: comparisons.reduce(
          (sum, entry) => sum + entry!.regressed + entry!.introduced,
          0,
        ),
        ...(selected !== undefined ? { visualConvergenceSelectedIteration: selected.iteration } : {}),
        visualConvergenceStopReason: stopReason ?? "iteration_limit_reached",
      },
      notes: notes.slice(0, 16),
    });

    return writeArtifact(context, {
      artifactId: V2_CONVERGENCE_ARTIFACT_IDS.convergence,
      artifactType: V2_CONVERGENCE_ARTIFACT_TYPES.convergence,
      name: "Visual Convergence",
      payload,
      summary: {
        status: payload.status,
        stopReason: payload.stopReason,
        iterationsPerformed: payload.iterationsPerformed,
        selectedIteration: payload.selectedIteration ?? null,
        selectedProposalHash: payload.selectedProposalHash ?? null,
        ...payload.metrics,
        // The whole loop is pre-approval; the registered project is untouched.
        projectFilesChanged: false,
      },
    });
  },
};
