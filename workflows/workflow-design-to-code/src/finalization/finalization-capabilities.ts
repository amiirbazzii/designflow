// workflows/workflow-design-to-code/src/finalization/finalization-capabilities.ts
//
// V2-7: the deterministic steps around approval and apply.
//
// Everything here is identity and authority. The convergence artifact names
// exactly one selected proposal; these steps resolve that exact payload, hold
// it to the one authoritative binding verifier at every boundary, present it
// for human approval, and finally prove that what was applied is what was
// selected. Zero model calls; the snapshot/apply/validation machinery itself
// is the existing stage-4 capability set, reused unchanged.
import { z } from "zod";
import {
  DesignFlowError,
  V2_FINAL_REVIEW_ARTIFACT_ID,
  V2_FINAL_REVIEW_ARTIFACT_TYPE,
  V2_FINALIZATION_RESULT_ARTIFACT_ID,
  V2_FINALIZATION_RESULT_ARTIFACT_TYPE,
  VISUAL_CONVERGENCE_ARTIFACT_ID,
  assertProjectProposalBinding,
  canonicalProposalHash,
  finalImplementationReviewSchema,
  implementationApprovalBindingSchema,
  implementationValidationReportSchema,
  proposedFileChangesSchema,
  v2FinalizationResultSchema,
  type Capability,
  type FinalImplementationReview,
  type ProposedFileChanges,
  type V2FinalizationResult,
  type VisualConvergenceArtifact,
} from "@designflow/sdk";
import { inspectRegisteredProject } from "@designflow/capability-implementation";

import { readArtifact, writeArtifact } from "../orchestration/artifact-io";
import { capabilityOutputSchema, type CapabilityOutput } from "../orchestration/types";
import { IMPLEMENTATION_ARTIFACT_IDS, IMPLEMENTATION_ARTIFACT_TYPES } from "../implementation/implementation-types";
import { resolveStoredPayload, v2FinalizeInputSchema } from "./finalization-types";

function fail(code: string, message: string): never {
  throw new DesignFlowError(code, message);
}

/**
 * Step 1: the registered project, inspected now and held to the convergence
 * base fingerprint. Drift here is a first-class outcome, not a retry.
 */
export const inspectFinalizationProjectCapability: Capability<unknown, CapabilityOutput> = {
  id: "inspect-finalization-project",
  name: "Inspect project for finalization",
  description: "Inspects the registered project and refuses to continue against a drifted base.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = v2FinalizeInputSchema.parse(raw);
    const inspected = inspectRegisteredProject(input.project);

    assertProjectProposalBinding(
      {
        ...(input.convergence.baseProjectFingerprint !== undefined
          ? { expectedProjectFingerprint: input.convergence.baseProjectFingerprint }
          : {}),
        actualProjectFingerprint: inspected.project.contextFingerprint,
      },
      () =>
        new DesignFlowError(
          "ERR_PROJECT_CHANGED",
          "PROJECT_CHANGED_BEFORE_APPROVAL: the approved implementation was created against an earlier project state. No files were changed.",
        ),
    );

    return writeArtifact(context, {
      artifactId: IMPLEMENTATION_ARTIFACT_IDS.projectContext,
      artifactType: IMPLEMENTATION_ARTIFACT_TYPES.projectContext,
      name: "Project implementation context",
      payload: inspected,
      summary: { projectId: inspected.project.id, projectFilesChanged: false },
    });
  },
};

/** §8's checks A–F over the convergence record and its selected proposal. */
function validateSelection(convergence: VisualConvergenceArtifact): {
  readonly ref: string;
  readonly hash: string;
  readonly iteration: number;
} {
  const ref = convergence.selectedProposalRef;
  const hash = convergence.selectedProposalHash;
  const iteration = convergence.selectedIteration;
  if (ref === undefined || hash === undefined || iteration === undefined)
    fail("ERR_CONVERGENCE_NOT_SELECTABLE", "The convergence record names no selected proposal; nothing can be finalized.");

  const selected = convergence.iterations.find((entry) => entry.iteration === iteration);
  if (selected === undefined)
    fail("ERR_CONVERGENCE_NOT_SELECTABLE", "The selected iteration does not exist in the convergence record.");
  if (!selected.quality.renderable)
    fail("ERR_CONVERGENCE_NOT_SELECTABLE", "The selected iteration was not a rendered, selectable state.");
  // Not superseded: the recorded selection still names this iteration's exact proposal.
  if (selected.proposalHash !== hash || selected.proposalRef !== ref)
    fail("ERR_PROPOSAL_BINDING_MISMATCH", "The convergence record's selection no longer matches its own iterations.");

  return { ref, hash, iteration };
}

/**
 * Step 2: resolve the exact selected proposal (V2-6's choice is authoritative
 * — nothing here picks a candidate) and persist it as the one canonical
 * proposal artifact the approval, snapshot and apply steps all read.
 */
export const resolveSelectedProposalCapability: Capability<unknown, CapabilityOutput> = {
  id: "resolve-selected-proposal",
  name: "Resolve selected proposal",
  description: "Resolves the convergence-selected proposal and verifies its exact identity.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = v2FinalizeInputSchema.parse(raw);
    const selection = validateSelection(input.convergence);

    const payload = await resolveStoredPayload(context, selection.ref);
    if (payload === undefined)
      fail("ERR_PROPOSAL_BINDING_MISMATCH", "The selected proposal artifact could not be resolved from storage.");
    const parsed = proposedFileChangesSchema.safeParse(payload);
    if (!parsed.success)
      fail("ERR_PROPOSAL_BINDING_MISMATCH", "The selected proposal artifact is not a valid proposal.");
    const proposal: ProposedFileChanges = parsed.data;

    // The exact-identity gate: stored bytes must hash to the recorded
    // selection, the proposal must belong to this project, and its base must
    // be the convergence base. All through the one authoritative verifier.
    assertProjectProposalBinding(
      {
        expectedProposalHash: selection.hash,
        actualProposalHash: canonicalProposalHash(proposal),
        expectedProjectId: input.project.id,
        actualProjectId: proposal.projectId,
        ...(input.convergence.baseProjectFingerprint !== undefined
          ? { expectedProjectFingerprint: input.convergence.baseProjectFingerprint }
          : {}),
        actualProjectFingerprint: proposal.baseProjectFingerprint,
      },
      (code, message) => new DesignFlowError(code, message),
    );

    return writeArtifact(context, {
      artifactId: IMPLEMENTATION_ARTIFACT_IDS.proposal,
      artifactType: IMPLEMENTATION_ARTIFACT_TYPES.proposal,
      name: "Selected proposal",
      payload: proposal,
      summary: {
        proposalHash: selection.hash,
        selectedIteration: selection.iteration,
        fileCount: proposal.files.length,
        projectFilesChanged: false,
      },
    });
  },
};

/**
 * Step 3: the deterministic review. A *view* of the exact proposal artifact
 * just stored — its file list comes from that payload, never from the last
 * convergence iteration or any generated summary. When P1 was selected over a
 * later P2, this is P1.
 */
export const storeFinalReviewCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-final-review",
  name: "Store final implementation review",
  description: "Derives the pre-approval review from the exact selected proposal.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = v2FinalizeInputSchema.parse(raw);
    const proposal = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.proposal, proposedFileChangesSchema);
    const selection = validateSelection(input.convergence);
    const selected = input.convergence.iterations.find((entry) => entry.iteration === selection.iteration)!;

    const review: FinalImplementationReview = finalImplementationReviewSchema.parse({
      schemaVersion: "1",
      proposalArtifactId: IMPLEMENTATION_ARTIFACT_IDS.proposal,
      proposalHash: selection.hash,
      projectId: proposal.projectId,
      baseProjectFingerprint: proposal.baseProjectFingerprint,
      convergence: {
        status: input.convergence.status,
        selectedIteration: selection.iteration,
        iterationsPerformed: input.convergence.iterationsPerformed,
      },
      visual: {
        outcome: selected.outcome,
        remainingFindingCount: selected.quality.actionableCount,
        remainingFindings:
          selected.quality.actionableCount > 0
            ? [`${selected.quality.actionableCount} remaining actionable finding(s) accepted by convergence policy`]
            : [],
      },
      files: proposal.files.map((file) => ({
        path: file.path,
        action: file.action,
        bytes: new TextEncoder().encode(file.content ?? "").length,
      })),
      packageChanges: proposal.packageChanges.map((change) => change.packageName),
      validationSummary: [
        "Proposal validated",
        "Project unchanged",
        "Snapshot will be created before apply",
        ...(input.convergence.status === "converged" ? ["Visual refinement complete"] : []),
        ...(input.convergence.status === "converged_with_findings" ? ["Visual result acceptable with findings"] : []),
      ],
    });

    return writeArtifact(context, {
      artifactId: V2_FINAL_REVIEW_ARTIFACT_ID,
      artifactType: V2_FINAL_REVIEW_ARTIFACT_TYPE,
      name: "Final implementation review",
      payload: review,
      summary: {
        proposalHash: review.proposalHash,
        fileCount: review.files.length,
        selectedIteration: review.convergence.selectedIteration,
        projectFilesChanged: false,
      },
    });
  },
};

/**
 * Step 8: the typed record of what happened, with the load-bearing equality
 * proven rather than assumed: selected hash = approval-bound hash = applied
 * hash. Runs only after required validation; the failure statuses that stop
 * earlier are recorded by the host through `unappliedFinalizationResult`.
 */
export const storeFinalizationResultCapability: Capability<unknown, CapabilityOutput> = {
  id: "store-finalization-result",
  name: "Store finalization result",
  description: "Proves selected = approved = applied and persists the final record.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, raw): Promise<CapabilityOutput> {
    const input = v2FinalizeInputSchema.parse(raw);
    const selection = validateSelection(input.convergence);
    const proposal = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.proposal, proposedFileChangesSchema);
    const approval = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.approval, implementationApprovalBindingSchema);
    const application = await readArtifact(
      context,
      IMPLEMENTATION_ARTIFACT_IDS.application,
      z.object({ runId: z.string(), proposalHash: z.string(), changedFiles: z.array(z.string()) }).passthrough(),
    );
    const validation = await readArtifact(context, IMPLEMENTATION_ARTIFACT_IDS.validation, implementationValidationReportSchema);

    // selected = approved = applied — the V2-7 invariant, verified here.
    let bindingChecks = 0;
    const check = (expectedProposalHash: string, actualProposalHash: string, label: string): void => {
      bindingChecks += 1;
      assertProjectProposalBinding(
        { expectedProposalHash, actualProposalHash },
        (code) => new DesignFlowError(code, `The ${label} proposal hash does not match the selected proposal.`),
      );
    };
    check(selection.hash, canonicalProposalHash(proposal), "reviewed");
    check(selection.hash, approval.proposalHash, "approved");
    check(selection.hash, application.proposalHash, "applied");

    const payload: V2FinalizationResult = v2FinalizationResultSchema.parse({
      schemaVersion: "1",
      status: validation.passed ? "applied_validated" : "validation_failed_rolled_back",
      binding: {
        projectId: proposal.projectId,
        baseProjectFingerprint: proposal.baseProjectFingerprint,
        proposalArtifactId: IMPLEMENTATION_ARTIFACT_IDS.proposal,
        proposalHash: selection.hash,
        approvalId: approval.approvalId,
        convergenceArtifactId: VISUAL_CONVERGENCE_ARTIFACT_ID,
        selectedIteration: selection.iteration,
      },
      appliedProposalHash: application.proposalHash,
      snapshotRef: IMPLEMENTATION_ARTIFACT_IDS.snapshot,
      applicationRef: IMPLEMENTATION_ARTIFACT_IDS.application,
      validationRef: IMPLEMENTATION_ARTIFACT_IDS.validation,
      rollbackPerformed: validation.rollbackTriggered,
      metrics: {
        finalizationSelectedIteration: selection.iteration,
        finalizationBindingChecks: bindingChecks,
        finalizationApprovalOutcome: "approved",
        finalizationProjectDriftDetected: false,
        finalizationSnapshotCreated: true,
        finalizationFilesApplied: validation.passed ? application.changedFiles.length : 0,
        finalizationValidationStatus: validation.passed ? "passed" : "failed",
        finalizationRollbackPerformed: validation.rollbackTriggered,
      },
      notes: validation.passed ? [] : ["Required validation failed after apply; the project was restored from the snapshot."],
    });

    return writeArtifact(context, {
      artifactId: V2_FINALIZATION_RESULT_ARTIFACT_ID,
      artifactType: V2_FINALIZATION_RESULT_ARTIFACT_TYPE,
      name: "Finalization result",
      payload,
      summary: { status: payload.status, ...payload.metrics, projectFilesChanged: validation.passed },
    });
  },
};

/**
 * The typed record for every run that stopped *before* any write — declined,
 * expired, drifted, mismatched, cancelled. Pure and host-callable, so the
 * outcome is a contract value even when the workflow never reached its last
 * node. Always zero writes, and says so.
 */
export function unappliedFinalizationResult(
  status: "approval_declined" | "approval_expired" | "project_changed" | "binding_mismatch" | "apply_failed" | "cancelled",
  convergence: VisualConvergenceArtifact,
  options: { readonly projectId: string; readonly approvalId?: string; readonly notes?: readonly string[] } ,
): V2FinalizationResult {
  return v2FinalizationResultSchema.parse({
    schemaVersion: "1",
    status,
    binding: {
      projectId: options.projectId,
      baseProjectFingerprint: convergence.baseProjectFingerprint ?? "unknown",
      proposalArtifactId: convergence.selectedProposalRef ?? "unresolved",
      proposalHash: convergence.selectedProposalHash ?? "unresolved",
      ...(options.approvalId !== undefined ? { approvalId: options.approvalId } : {}),
      convergenceArtifactId: VISUAL_CONVERGENCE_ARTIFACT_ID,
      ...(convergence.selectedIteration !== undefined ? { selectedIteration: convergence.selectedIteration } : {}),
    },
    rollbackPerformed: false,
    metrics: {
      ...(convergence.selectedIteration !== undefined
        ? { finalizationSelectedIteration: convergence.selectedIteration }
        : {}),
      finalizationBindingChecks: 0,
      finalizationApprovalOutcome:
        status === "approval_declined" ? "declined" : status === "approval_expired" ? "expired" : "not_requested",
      finalizationProjectDriftDetected: status === "project_changed",
      finalizationSnapshotCreated: false,
      finalizationFilesApplied: 0,
      finalizationValidationStatus: "not_run",
      finalizationRollbackPerformed: false,
    },
    notes: [...(options.notes ?? []), "No files were changed by DesignFlow."],
  });
}
