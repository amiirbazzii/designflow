import { z } from "zod";
import {
  inspectRegisteredProject,
  applyProjectFileChanges,
  createProjectSnapshot,
  rollbackProjectSnapshot,
  validateProject,
  type ProjectSnapshot,
} from "@designflow/capability-implementation";
import {
  DesignFlowError,
  correctionApprovalBindingV1Schema,
  correctionContextV1Schema,
  correctionPlanV1Schema,
  feedbackLoopIterationV1Schema,
  feedbackLoopReportV1Schema,
  proposedCorrectionChangeV1Schema,
  proposedFileChangesSchema,
  visualValidationReportV1Schema,
  type Capability,
} from "@designflow/sdk";
import { readArtifact, writeArtifact } from "./artifact-io";
import { capabilityOutputSchema, type CapabilityOutput } from "./types";
import {
  actionableFindingSelectionSchema,
  correctionAgentOutputSchema,
  FEEDBACK_LOOP_ARTIFACT_IDS,
  FEEDBACK_LOOP_ARTIFACT_TYPES,
  feedbackLoopWorkflowInputSchema,
  proposedCorrectionChangesSchema,
  type FeedbackLoopWorkflowInput,
} from "./feedback-loop-types";
import {
  affectedFilesForFinding,
  selectActionableFindings,
  selectedFindingRecords,
} from "./feedback-loop-selection";
import {
  correctionToImplementationProposal,
  objectHash,
  readBoundedExcerpt,
  sha256,
  validateCorrectionAgentOutput,
} from "./feedback-loop-utils";
import {
  runFreshStage5Validation,
  storeRevalidatedReport,
  visualValidationInconclusiveReason,
} from "./feedback-loop-revalidation";
import { configuredBrowserRenderer } from "./visual-validation-runtime";
import { deriveCompositionScope } from "./composition-scope";
import {
  MAX_CORRECTION_PROPOSAL_ATTEMPTS,
  preflightCorrectionProposal,
} from "./correction-runtime-preflight";

const inputSchema = feedbackLoopWorkflowInputSchema;
const projectInput = (raw: unknown): FeedbackLoopWorkflowInput =>
  inputSchema.parse(raw);
const requireAgents = (
  context: import("@designflow/sdk").CapabilityContext,
) => {
  if (!context.agents)
    throw new Error("Visual Correction Agent invocation is unavailable.");
  return context.agents;
};
async function initialVisualReport(
  context: import("@designflow/sdk").CapabilityContext,
  input: FeedbackLoopWorkflowInput,
) {
  try {
    return await readArtifact(
      context,
      "visual-validation-report",
      visualValidationReportV1Schema,
    );
  } catch {
    if (input.initialVisualValidationReport === undefined)
      throw new DesignFlowError(
        "ERR_MISSING_VISUAL_REPORT",
        "The latest Visual Validation Report is not available.",
      );
    return visualValidationReportV1Schema.parse(
      input.initialVisualValidationReport,
    );
  }
}

function artifactLink(
  context: import("@designflow/sdk").CapabilityContext,
  artifactId: string,
): { artifactId: string; artifactHash: string; version: string } | undefined {
  const ref = context.parentArtifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  const payloadId = ref?.metadata["payloadId"];
  return ref !== undefined &&
    typeof payloadId === "string" &&
    /^[a-f0-9]{64}$/.test(payloadId)
    ? {
        artifactId,
        artifactHash: payloadId,
        version: String(ref.metadata["version"] ?? "1"),
      }
    : undefined;
}

const projectValidationSchema = z
  .object({
    status: z.enum(["passed", "failed", "timed_out"]),
    checks: z
      .array(
        z
          .object({
            name: z.string(),
            status: z.enum(["passed", "failed", "skipped", "unavailable"]),
            required: z.boolean(),
            outputArtifactId: z.string().optional(),
          })
          .strict(),
      )
      .max(8),
    rollback: z.enum(["not_required", "passed", "failed"]),
  })
  .strict();

export const storeFeedbackLoopInputCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "store-feedback-loop-input",
  name: "Store feedback loop input",
  description: "Stores the immutable Stage 6 input boundary.",
  type: "pure",
  version: "1",
  inputSchema,
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const value = inputSchema.parse(input);
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.input,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.input,
      name: "Feedback Loop Input",
      payload: value,
      summary: {
        projectId: value.project.id,
        report: value.latestVisualValidationReport.artifactHash,
        iterationLimit: value.iterationPolicy.maxIterations,
      },
    });
  },
};

export const selectActionableFindingsCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "select-actionable-findings",
  name: "Select actionable findings",
  description:
    "Applies deterministic evidence, severity, confidence, and scope policy.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const requested = projectInput(input);
    const report = await initialVisualReport(context, requested);
    const selection = selectActionableFindings(report, requested);
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.selection,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.selection,
      name: "Actionable Finding Selection",
      payload: selection,
      summary: {
        selected: selection.selectedFindingIds.length,
        excluded: selection.excludedFindingIds.length,
        stopReason: selection.stopReason ?? "none",
      },
    });
  },
};

export const prepareCorrectionContextCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "prepare-correction-context",
  name: "Prepare correction context",
  description:
    "Builds bounded excerpts and evidence references for the proposal-only agent.",
  type: "read_fs",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const requested = projectInput(input);
    const report = await initialVisualReport(context, requested);
    const selection = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.selection,
      actionableFindingSelectionSchema,
    );
    if (selection.stopReason || selection.selectedFindingIds.length === 0)
      throw new DesignFlowError("ERR_NO_ACTIONABLE_FINDINGS", selection.reason);
    const project = inspectRegisteredProject(requested.project);
    if (project.project.contextFingerprint !== requested.projectFingerprint)
      throw new DesignFlowError(
        "ERR_PROJECT_FINGERPRINT_CHANGED",
        "The registered project changed before correction planning.",
      );
    const findings = selectedFindingRecords(report, requested, selection);
    const paths = [
      ...new Set(
        findings.flatMap((finding) =>
          affectedFilesForFinding(finding, requested),
        ),
      ),
    ];
    // A root-frame finding (whole-page evidence, no component identity) may
    // additionally reach the host-derived composition scope — the preview
    // entry and the root components it imports — so a correction can repair
    // integration mistakes such as generated UI that is never mounted. The
    // set is deterministic, bounded, and only files that also yield a valid
    // bounded excerpt become part of the enforced scope.
    const hasRootFrameFinding = findings.some(
      (finding) =>
        finding.affectedFrame !== undefined &&
        finding.affectedComponent === undefined,
    );
    const compositionAuthorized: {
      entry: import("@designflow/sdk").CompositionScopeEntry;
      excerpt: ReturnType<typeof readBoundedExcerpt>;
    }[] = [];
    if (hasRootFrameFinding) {
      for (const entry of deriveCompositionScope(requested.project.rootPath)) {
        if (paths.includes(entry.path)) continue;
        try {
          compositionAuthorized.push({
            entry,
            excerpt: readBoundedExcerpt(requested.project.rootPath, entry.path),
          });
        } catch {
          // A composition candidate that cannot be safely excerpted stays out
          // of the scope entirely rather than weakening the excerpt/hash bond.
        }
      }
    }
    const compositionPaths = compositionAuthorized.map(
      (candidate) => candidate.entry.path,
    );
    const scopePaths = [...paths, ...compositionPaths];
    const excerpts = [
      ...paths.map((path) =>
        readBoundedExcerpt(requested.project.rootPath, path),
      ),
      ...compositionAuthorized.map((candidate) => candidate.excerpt),
    ];
    const evidenceReferences = [
      ...report.implementationEvidence,
      ...report.referenceEvidence,
    ].map((evidence) => ({
      artifactId: evidence.evidenceId,
      artifactHash: objectHash(evidence),
      version: "1",
    }));
    const value = correctionContextV1Schema.parse({
      schemaVersion: "1",
      iterationNumber: requested.iterationNumber,
      selectedFindings: findings.map((finding) => ({
        findingId: finding.findingId,
        classification: finding.origin,
        affectedFiles: [
          ...new Set([
            ...(requested.affectedFileMap[finding.findingId] ?? []),
            ...(finding.affectedFrame !== undefined &&
            finding.affectedComponent === undefined
              ? compositionPaths
              : []),
          ]),
        ],
        ...(finding.affectedComponent
          ? { component: finding.affectedComponent }
          : {}),
        evidenceReferences: finding.evidenceReferences,
        ...(finding.expectedValue ? { expected: finding.expectedValue } : {}),
        ...(finding.actualValue ? { actual: finding.actualValue } : {}),
        ...(finding.measurableDelta !== undefined
          ? { measurableDelta: finding.measurableDelta }
          : {}),
      })),
      visualFindings: findings,
      evidenceReferences,
      currentImplementationExcerpts: excerpts,
      relevantDesignTokens: project.designSystem.tokens
        .slice(0, 128)
        .map((token) => ({
          name: token.name,
          reference: token.reference,
          ...(token.value ? { value: token.value } : {}),
        })),
      relevantComponents: project.designSystem.components
        .slice(0, 64)
        .map((component) => ({
          name: component.name,
          path: component.sourcePath,
        })),
      allowedFileScope: scopePaths,
      compositionAuthorizedFiles: compositionAuthorized.map(
        (candidate) => candidate.entry,
      ),
      forbiddenPaths: [
        ".env*",
        "node_modules",
        "dist",
        "build",
        ".designflow",
        "lockfiles",
      ],
      projectCommands: Object.values(project.commands)
        .filter(
          (command): command is NonNullable<typeof command> =>
            command !== undefined,
        )
        .map((command) => ({
          name: command.name,
          executable: command.executable as "npm" | "bun" | "pnpm" | "yarn",
          args: command.args,
          required: command.required,
        })),
      currentProjectFingerprint: project.project.contextFingerprint,
      currentImplementationHash: requested.currentImplementationHash,
      previousIterationSummaries: [],
      designSystemMapping: requested.designSystemMapping,
      evidenceOnly: true,
    });
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.context,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.context,
      name: "Correction Context",
      payload: value,
      summary: {
        findings: findings.length,
        files: scopePaths.length,
        compositionAuthorizedFiles: compositionPaths,
        boundedBytes: excerpts.reduce(
          (total, excerpt) => total + Buffer.byteLength(excerpt.content),
          0,
        ),
      },
    });
  },
};

export const invokeVisualCorrectionAgentCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "invoke-visual-correction-agent",
  name: "Invoke Visual Correction Agent",
  description:
    "Requests a structured proposal from the no-write Correction Agent.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const input = inputSchema.parse(
      await readArtifact(
        context,
        FEEDBACK_LOOP_ARTIFACT_IDS.input,
        inputSchema,
      ),
    );
    const correctionContext = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.context,
      correctionContextV1Schema,
    );
    const project = inspectRegisteredProject(input.project, {}, context.signal);
    if (project.project.contextFingerprint !== input.projectFingerprint)
      throw new DesignFlowError(
        "ERR_PROJECT_FINGERPRINT_CHANGED",
        "The registered project changed before correction preflight.",
      );
    const failures: Array<{
      readonly attempt: number;
      readonly proposalHash: string;
      readonly code: string;
      readonly compile: "passed" | "failed" | "unavailable";
      readonly runtime: "passed" | "failed" | "unavailable";
      readonly diagnostics: readonly { readonly message: string }[];
    }> = [];
    let repairFeedback: Record<string, unknown> | undefined;
    for (let attempt = 1; attempt <= MAX_CORRECTION_PROPOSAL_ATTEMPTS; attempt += 1) {
      if (context.signal.aborted)
        throw new DesignFlowError(
          "ERR_CORRECTION_PROPOSAL_ATTEMPT_CANCELLED",
          "Correction proposal preparation was cancelled; no approval was requested.",
          { attempt },
        );
      const result = await requireAgents(context).invoke(
        {
          agentId: "visual-correction-agent",
          objective: `Prepare correction proposal for iteration ${correctionContext.iterationNumber}.`,
          input: {
            correctionContext,
            ...(repairFeedback === undefined ? {} : { correctionRepairFeedback: repairFeedback }),
          },
          attempt,
          metadata: { workflowId: context.workflowId, projectId: input.project.id },
        },
        context.signal,
      );
      if (result.type === "failure")
        throw new DesignFlowError(
          result.code,
          "The Visual Correction Agent failed to produce a proposal.",
        );
      const output = validateCorrectionAgentOutput(
        result.output,
        correctionContextV1Schema.parse(correctionContext),
        input,
      );
      const proposal = proposedFileChangesSchema.parse(
        correctionToImplementationProposal(
          project.project.id,
          project.project.contextFingerprint,
          output,
        ),
      );
      const preflight = await preflightCorrectionProposal(
        input.project.rootPath,
        project,
        proposal,
        input.viewportConfiguration.viewports,
        context.signal,
        configuredBrowserRenderer(context.config.visualRenderer),
      );
      const runtimeFailureCode = preflight.compile.status !== "passed"
        ? "ERR_CORRECTION_COMPILE_PREFLIGHT_FAILED"
        : preflight.runtime.status !== "passed"
          ? "ERR_CORRECTION_RUNTIME_PREFLIGHT_FAILED"
          : undefined;
      const diagnostics = preflight.compile.status !== "passed"
        ? preflight.compile.diagnostics
        : preflight.runtime.diagnostics;
      await writeArtifact(context, {
        artifactId: `correction-proposal-attempt-${attempt}`,
        artifactType: "feedback.correction-proposal-attempt",
        name: `Correction Proposal Attempt ${attempt}`,
        payload: {
          schemaVersion: "1",
          attempt,
          proposalHash: preflight.proposalHash,
          validationOutcome: runtimeFailureCode === undefined ? "passed" : "failed",
          compile: preflight.compile.status,
          runtime: preflight.runtime.status,
          diagnostics: diagnostics.slice(0, 12),
        },
        summary: {
          attempt,
          proposalHash: preflight.proposalHash,
          compile: preflight.compile.status,
          runtime: preflight.runtime.status,
          ...(runtimeFailureCode === undefined ? {} : { code: runtimeFailureCode }),
        },
      });
      if (runtimeFailureCode === undefined)
        return writeArtifact(context, {
          artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.agentOutput,
          artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.agentOutput,
          name: "Correction Agent Output",
          payload: output,
          summary: {
            files: output.changes.length,
            findings: output.plan.selectedFindingIds.length,
            traceIds: output.traceIds,
            proposalAttempts: attempt,
            preflightProposalHash: preflight.proposalHash,
            preflightCompile: preflight.compile.status,
            preflightRuntime: preflight.runtime.status,
          },
        });
      failures.push({
        attempt,
        proposalHash: preflight.proposalHash,
        code: runtimeFailureCode,
        compile: preflight.compile.status,
        runtime: preflight.runtime.status,
        diagnostics: diagnostics.slice(0, 12),
      });
      if (attempt === MAX_CORRECTION_PROPOSAL_ATTEMPTS)
        throw new DesignFlowError(
          "ERR_CORRECTION_PROPOSAL_ATTEMPTS_EXHAUSTED",
          `Correction proposals remained invalid after ${MAX_CORRECTION_PROPOSAL_ATTEMPTS} bounded attempts; no approval was requested and no files were changed.`,
          {
            attempts: attempt,
            attemptsExhausted: true,
            failures: failures.map((failure) => ({
              attempt: failure.attempt,
              proposalHash: failure.proposalHash,
              code: failure.code,
              compile: failure.compile,
              runtime: failure.runtime,
              diagnostics: failure.diagnostics,
            })),
          },
        );
      repairFeedback = {
        attempt,
        maxAttempts: MAX_CORRECTION_PROPOSAL_ATTEMPTS,
        code: runtimeFailureCode,
        runtimeDiagnostics: diagnostics.slice(0, 12),
        rule: "repair only the deterministic runtime or compile failure facts; preserve the same finding scope and one-iteration authorization",
      };
    }
    throw new DesignFlowError(
      "ERR_CORRECTION_PROPOSAL_ATTEMPTS_EXHAUSTED",
      "Correction proposal attempts were exhausted.",
      { attempts: MAX_CORRECTION_PROPOSAL_ATTEMPTS },
    );
  },
};

export const storeCorrectionPlanCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "store-correction-plan",
  name: "Store correction plan",
  description:
    "Stores the validated proposal plan separately from its file changes.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const output = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.agentOutput,
      correctionAgentOutputSchema,
    );
    const plan = correctionPlanV1Schema.parse(output.plan);
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.plan,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.plan,
      name: "Correction Plan",
      payload: plan,
      summary: {
        iteration: plan.iterationNumber,
        findings: plan.selectedFindingIds.length,
        files: plan.filesExpectedToChange.length,
      },
    });
  },
};

export const storeProposedCorrectionChangesCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "store-proposed-correction-changes",
  name: "Store proposed correction changes",
  description: "Stores exact bounded content hashes before approval.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const input = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.input,
      inputSchema,
    );
    const output = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.agentOutput,
      correctionAgentOutputSchema,
    );
    const changes = output.changes.map((change) =>
      proposedCorrectionChangeV1Schema.parse(change),
    );
    const project = inspectRegisteredProject(input.project);
    const exactProposal = proposedFileChangesSchema.parse(
      correctionToImplementationProposal(
        project.project.id,
        project.project.contextFingerprint,
        output,
      ),
    );
    const payload = proposedCorrectionChangesSchema.parse({
      schemaVersion: "1",
      changes,
      contentHash: objectHash(changes),
      totalBytes: changes.reduce(
        (total, change) =>
          total + Buffer.byteLength(change.proposedContent ?? ""),
        0,
      ),
      dependencyCount: changes.filter(
        (change) => change.dependencyChangeRequired,
      ).length,
      preflightProposalHash: objectHash(exactProposal),
    });
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.changes,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.changes,
      name: "Proposed Correction Changes",
      payload,
      summary: {
        files: changes.length,
        bytes: payload.totalBytes,
        contentHash: payload.contentHash,
      },
    });
  },
};

export const requestCorrectionApprovalCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "request-correction-approval",
  name: "Request correction approval",
  description:
    "Binds approval to the exact report, plan, proposal, project, and revalidation configuration.",
  type: "human_gate",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const input = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.input,
      inputSchema,
    );
    const plan = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.plan,
      correctionPlanV1Schema,
    );
    const changes = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.changes,
      proposedCorrectionChangesSchema,
    );
    const now = new Date();
    const planHash = objectHash(plan);
    const changesHash = objectHash(changes);
    const approvalId = sha256(
      `${context.executionId}:${planHash}:${changesHash}`,
    ).slice(0, 32);
    const binding = correctionApprovalBindingV1Schema.parse({
      schemaVersion: "1",
      workflowId: context.workflowId,
      executionId: context.executionId,
      iterationId: `${context.executionId}:${plan.iterationNumber}`,
      iterationNumber: plan.iterationNumber,
      correctionPlanArtifactId: FEEDBACK_LOOP_ARTIFACT_IDS.plan,
      correctionPlanHash: planHash,
      proposedCorrectionArtifactId: FEEDBACK_LOOP_ARTIFACT_IDS.changes,
      proposedCorrectionHash: changesHash,
      ...(changes.preflightProposalHash !== undefined
        ? { preflightProposalHash: changes.preflightProposalHash }
        : {}),
      selectedFindingIds: plan.selectedFindingIds,
      projectId: input.project.id,
      canonicalRootIdentity: input.project.canonicalRootIdentity,
      currentProjectFingerprint: input.projectFingerprint,
      currentImplementationHash: input.currentImplementationHash,
      previousVisualReportHash: input.latestVisualValidationReport.artifactHash,
      fileCount: changes.changes.length,
      dependencyCount: changes.dependencyCount,
      validationCommands: plan.validationCommands,
      revalidationConfigurationHash: objectHash(input.viewportConfiguration),
      approvalId,
      expiresAt: new Date(
        now.getTime() + input.timeouts.approvalMs,
      ).toISOString(),
      protectedNodeId: "create-correction-snapshot",
      consumed: false,
    });
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.approval,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.approval,
      name: "Correction Approval Binding",
      payload: binding,
      summary: {
        approvalId,
        iteration: binding.iterationNumber,
        fileCount: binding.fileCount,
        noFilesChanged: true,
      },
    });
  },
};

export const createCorrectionSnapshotCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "create-correction-snapshot",
  name: "Create correction snapshot",
  description:
    "Creates exactly one scoped snapshot immediately after the external approval boundary.",
  type: "write_fs",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const requested = projectInput(input);
    const plan = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.plan,
      correctionPlanV1Schema,
    );
    const changes = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.changes,
      proposedCorrectionChangesSchema,
    );
    const binding = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.approval,
      correctionApprovalBindingV1Schema,
    );
    const current = inspectRegisteredProject(requested.project);
    if (
      binding.consumed ||
      binding.correctionPlanHash !== objectHash(plan) ||
      binding.proposedCorrectionHash !== objectHash(changes) ||
      binding.projectId !== requested.project.id ||
      binding.canonicalRootIdentity !==
        requested.project.canonicalRootIdentity ||
      binding.currentProjectFingerprint !== requested.projectFingerprint ||
      current.project.contextFingerprint !== requested.projectFingerprint
    )
      throw new DesignFlowError(
        "ERR_CORRECTION_APPROVAL_MISMATCH",
        "Correction approval is stale, consumed, or no longer matches the project and exact proposal.",
      );
    const proposal = proposedFileChangesSchema.parse(
      correctionToImplementationProposal(
        requested.project.id,
        requested.projectFingerprint,
        { schemaVersion: "1", plan, changes: changes.changes, traceIds: [] },
      ),
    );
    if (
      binding.preflightProposalHash !== undefined &&
      binding.preflightProposalHash !== objectHash(proposal)
    )
      throw new DesignFlowError(
        "ERR_CORRECTION_APPROVAL_MISMATCH",
        "Correction approval is not bound to the preflighted proposal.",
      );
    // Only files the parent implementation run itself applied carry the
    // provenance-backed dirty-target exemption: `validateCorrectionAgentOutput`
    // bound them to the approved file scope and verified each base hash, and
    // the parent run holds its own rollback snapshot, so they are
    // uncommitted-by-definition. Host-authorized composition files have no
    // such provenance — if one is dirty with unrelated local changes, the
    // git-safety gate must still fail closed.
    const parentChanged = new Set(requested.parentChangedFiles);
    const snapshot = await createProjectSnapshot(
      requested.project.id,
      requested.project.rootPath,
      proposal,
      requested.project.canonicalRootIdentity,
      requested.stateDirectory,
      {
        exemptDirtyTargets: proposal.files
          .map((file) => file.path)
          .filter((path) => parentChanged.has(path)),
      },
    );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.snapshot,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.snapshot,
      name: "Correction Snapshot",
      payload: snapshot,
      summary: {
        runId: snapshot.runId,
        files: snapshot.entries.length,
        approvalId: binding.approvalId,
      },
    });
  },
};

export const consumeCorrectionApprovalCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "consume-correction-approval",
  name: "Consume correction approval",
  description:
    "Records one-time consumption after the snapshot exists and before application.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const binding = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.approval,
      correctionApprovalBindingV1Schema,
    );
    if (binding.consumed)
      throw new DesignFlowError(
        "ERR_APPROVAL_CONSUMED",
        "Correction approval has already been consumed.",
      );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.approvalConsumed,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.approval,
      name: "Consumed Correction Approval Binding",
      payload: { ...binding, consumed: true },
      summary: { approvalId: binding.approvalId, consumed: true },
    });
  },
};

export const applyApprovedCorrectionCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "apply-approved-correction",
  name: "Apply approved correction",
  description:
    "Applies only the exact content validated by the consumed approval binding and snapshot.",
  type: "write_fs",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const requested = projectInput(input);
    const changes = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.changes,
      proposedCorrectionChangesSchema,
    );
    const binding = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.approvalConsumed,
      correctionApprovalBindingV1Schema,
    );
    const snapshot = (await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.snapshot,
      z.unknown(),
    )) as ProjectSnapshot;
    if (!binding.consumed)
      throw new DesignFlowError(
        "ERR_APPROVAL_NOT_CONSUMED",
        "Correction approval was not consumed at the snapshot boundary.",
      );
    const output = {
      schemaVersion: "1",
      changes: changes.changes.map((change) => ({
        schemaVersion: "1",
        operation: change.operation,
        relativePath: change.relativePath,
        baseFileHash: change.baseFileHash,
        proposedContentHash: change.proposedContentHash,
        proposedContent: change.proposedContent,
        patch: change.patch,
        reason: change.reason,
        findingIds: change.findingIds,
        evidenceIds: change.evidenceIds,
        expectedMeasurableOutcome: change.expectedMeasurableOutcome,
        designSystemReferences: change.designSystemReferences,
        dependencyChangeRequired: change.dependencyChangeRequired,
      })),
    };
    const agentOutput = {
      schemaVersion: "1" as const,
      plan: await readArtifact(
        context,
        FEEDBACK_LOOP_ARTIFACT_IDS.plan,
        correctionPlanV1Schema,
      ),
      changes: output.changes.map((change) =>
        proposedCorrectionChangeV1Schema.parse(change),
      ),
      traceIds: [],
    };
    const proposal = proposedFileChangesSchema.parse(
      correctionToImplementationProposal(
        requested.project.id,
        requested.projectFingerprint,
        agentOutput,
      ),
    );
    if (
      binding.preflightProposalHash !== undefined &&
      binding.preflightProposalHash !== objectHash(proposal)
    )
      throw new DesignFlowError(
        "ERR_CORRECTION_APPROVAL_MISMATCH",
        "Correction approval is not bound to the preflighted proposal.",
      );
    const result = await applyProjectFileChanges(
      requested.project.id,
      requested.project.rootPath,
      proposal,
      requested.project.canonicalRootIdentity,
      requested.stateDirectory,
      snapshot,
    );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.application,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.application,
      name: "Correction Application Result",
      payload: result,
      summary: {
        runId: result.runId,
        changedFiles: result.changedFiles,
        filesChanged: result.changedFiles.length,
      },
    });
  },
};

export const validateCorrectionProjectCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "run-correction-project-validation",
  name: "Run correction project validation",
  description:
    "Runs only registered safe commands and rolls back required failures.",
  type: "write_fs",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const requested = projectInput(input);
    const project = inspectRegisteredProject(requested.project);
    const application = (await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.application,
      z.unknown(),
    )) as { snapshot: ProjectSnapshot; changedFiles: string[] };
    const checks = await validateProject(project, requested.project.rootPath, {
      signal: context.signal,
    });
    const failed = checks.some(
      (check) => check.required && check.status !== "passed",
    );
    let rollback: "not_required" | "passed" | "failed" = "not_required";
    if (failed) {
      try {
        await rollbackProjectSnapshot(
          requested.project.rootPath,
          application.snapshot,
        );
        rollback = "passed";
      } catch {
        rollback = "failed";
      }
    }
    const report = {
      status: failed ? ("failed" as const) : ("passed" as const),
      checks: checks.map((check) => ({
        name: check.name,
        status: check.status,
        required: check.required,
        ...(check.logArtifactId
          ? { outputArtifactId: check.logArtifactId }
          : {}),
      })),
      rollback,
    };
    if (failed && rollback === "failed")
      throw new DesignFlowError(
        "ERR_ROLLBACK_FAILED",
        "Required project validation failed and rollback could not be verified.",
      );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.validation,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.validation,
      name: "Correction Project Validation",
      payload: report,
      summary: { status: report.status, rollback },
    });
  },
};

export const revalidateVisualValidationCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "rerun-visual-validation",
  name: "Rerun visual validation",
  description:
    "Requires a fresh Stage 5 report after mutation and never reuses the pre-mutation report.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const validation = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.validation,
      projectValidationSchema,
    );
    if (validation.status !== "passed")
      return writeArtifact(context, {
        artifactId: "feedback-loop-revalidation-output",
        artifactType: "feedback.revalidation-gate",
        name: "Visual Revalidation Gate",
        payload: { status: "stopped", reason: "project_validation_failed" },
        summary: { status: "stopped", reason: "project_validation_failed" },
      });
    const input = inputSchema.parse(
      await readArtifact(
        context,
        FEEDBACK_LOOP_ARTIFACT_IDS.input,
        inputSchema,
      ),
    );
    let fresh;
    if (input.revalidatedVisualValidationReport !== undefined) {
      fresh = visualValidationReportV1Schema.parse(
        input.revalidatedVisualValidationReport,
      );
    } else {
      try {
        fresh = await readArtifact(
          context,
          FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport,
          visualValidationReportV1Schema,
        );
      } catch {
        return writeArtifact(context, {
          artifactId: "feedback-loop-revalidation-gate",
          artifactType: "feedback.revalidation-gate",
          name: "Visual Revalidation Gate",
          payload: {
            status: "stopped",
            reason: "visual_validation_inconclusive",
          },
          summary: {
            status: "stopped",
            reason: "visual_validation_inconclusive",
          },
        });
      }
    }
    if (objectHash(fresh) === input.latestVisualValidationReport.artifactHash)
      return writeArtifact(context, {
        artifactId: "feedback-loop-revalidation-gate",
        artifactType: "feedback.revalidation-gate",
        name: "Visual Revalidation Gate",
        payload: {
          status: "stopped",
          reason: "visual_validation_inconclusive",
        },
        summary: {
          status: "stopped",
          reason: "visual_validation_inconclusive",
        },
      });
    return writeArtifact(context, {
      artifactId: "feedback-loop-revalidation-gate",
      artifactType: "feedback.revalidation-gate",
      name: "Visual Revalidation Gate",
      payload: { status: "ready", report: fresh },
      summary: {
        status: "ready",
        reportStatus: fresh.overallStatus,
        capturedViewports: fresh.coverage.capturedViewports,
      },
    });
  },
};

export const evaluateFeedbackLoopCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "evaluate-feedback-loop",
  name: "Evaluate feedback loop",
  description:
    "Evaluates deterministic resolution, regression, improvement, and stop policy.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context, input) {
    const requested = projectInput(input);
    const initial = await initialVisualReport(context, requested);
    const validation = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.validation,
      projectValidationSchema,
    );
    const application = (await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.application,
      z.unknown(),
    ).catch(() => undefined)) as { changedFiles?: string[] } | undefined;
    const gate = (await readArtifact(
      context,
      "feedback-loop-revalidation-gate",
      z.unknown(),
    )) as {
      status: "ready" | "stopped";
      reason?: string;
      report?: import("@designflow/sdk").VisualValidationReportV1;
      inconclusiveReason?: import("@designflow/sdk").VisualValidationInconclusiveReason;
    };
    const now = new Date().toISOString();
    const initialMajor = initial.findings.filter(
      (finding) =>
        finding.severity === "major" || finding.severity === "critical",
    );
    const fresh = gate.status === "ready" ? gate.report : undefined;
    const freshMajor =
      fresh?.findings.filter(
        (finding) =>
          finding.severity === "major" || finding.severity === "critical",
      ) ?? initialMajor;
    const resolved = initialMajor
      .filter(
        (finding) =>
          !freshMajor.some(
            (candidate) => candidate.findingId === finding.findingId,
          ),
      )
      .map((finding) => finding.findingId);
    const introduced = freshMajor
      .filter(
        (finding) =>
          !initialMajor.some(
            (candidate) => candidate.findingId === finding.findingId,
          ),
      )
      .map((finding) => finding.findingId);
    const remaining = freshMajor.map((finding) => finding.findingId);
    const oldMetric = initial.viewportResults.reduce(
      (sum, result) => sum + (result.metrics.pixelMismatchRatio ?? 0),
      0,
    );
    const newMetric =
      fresh?.viewportResults.reduce(
        (sum, result) => sum + (result.metrics.pixelMismatchRatio ?? 0),
        0,
      ) ?? oldMetric;
    const improved = resolved.length > 0 || newMetric < oldMetric;
    const continuationAllowed =
      improved &&
      introduced.length === 0 &&
      remaining.length > 0 &&
      requested.iterationPolicy.continueAfterImprovement &&
      requested.iterationNumber < requested.iterationPolicy.maxIterations;
    let stopReason: import("@designflow/sdk").FeedbackLoopStopReason;
    let finalStatus: "pass" | "pass_with_findings" | "fail" | "stopped";
    if (validation.status !== "passed") {
      stopReason = "project_validation_failed";
      finalStatus = "stopped";
    } else if (gate.status !== "ready" || fresh === undefined) {
      stopReason =
        (gate.reason as
          import("@designflow/sdk").FeedbackLoopStopReason | undefined) ??
        "visual_validation_inconclusive";
      finalStatus = "stopped";
    } else if (fresh.overallStatus === "pass") {
      stopReason = "passed";
      finalStatus = "pass";
    } else if (
      fresh.overallStatus === "pass_with_findings" &&
      remaining.length === 0
    ) {
      stopReason = "pass_with_findings";
      finalStatus = "pass_with_findings";
    } else if (introduced.length > 0) {
      stopReason = "regression_detected";
      finalStatus = "fail";
    } else if (!improved) {
      stopReason = "no_improvement";
      finalStatus = "fail";
    } else if (requested.iterationPolicy.maxIterations <= 1) {
      stopReason = "iteration_limit_reached";
      finalStatus = "fail";
    } else {
      stopReason = "iteration_limit_reached";
      finalStatus = "fail";
    }
    const iteration = feedbackLoopIterationV1Schema.parse({
      schemaVersion: "1",
      iterationId: `${context.executionId}:${requested.iterationNumber}`,
      iterationNumber: requested.iterationNumber,
      inputReportId: requested.latestVisualValidationReport.artifactId,
      selectedFindings: initialMajor.map((finding) => finding.findingId),
      ...(artifactLink(context, FEEDBACK_LOOP_ARTIFACT_IDS.plan) !== undefined
        ? {
            correctionPlanArtifact: artifactLink(
              context,
              FEEDBACK_LOOP_ARTIFACT_IDS.plan,
            ),
          }
        : {}),
      approvalOutcome: "approved",
      ...(artifactLink(context, FEEDBACK_LOOP_ARTIFACT_IDS.snapshot) !==
      undefined
        ? {
            snapshotArtifact: artifactLink(
              context,
              FEEDBACK_LOOP_ARTIFACT_IDS.snapshot,
            ),
          }
        : {}),
      ...(application !== undefined
        ? {
            applicationResult: {
              status: "passed",
              changedFiles: application.changedFiles ?? [],
              bytesChanged: 0,
            },
          }
        : {}),
      projectValidationResult: {
        status: validation.status,
        checks: validation.checks,
      },
      rollbackResult: { status: validation.rollback },
      ...(artifactLink(
        context,
        FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport,
      ) !== undefined
        ? {
            newVisualValidationReport: artifactLink(
              context,
              FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport,
            ),
          }
        : {}),
      findingsResolved: resolved,
      findingsRemaining: remaining,
      findingsIntroduced: introduced,
      metricDeltas: { pixelMismatchRatio: newMetric - oldMetric },
      status:
        finalStatus === "pass" || finalStatus === "pass_with_findings"
          ? "passed"
          : "failed",
      stopReason,
      startedAt: now,
      endedAt: now,
      traceIds: [],
    });
    const report = feedbackLoopReportV1Schema.parse({
      schemaVersion: "1",
      projectId: requested.project.id,
      initialVisualReportId: requested.latestVisualValidationReport.artifactId,
      finalVisualReportId:
        fresh?.projectId === requested.project.id
          ? FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport
          : requested.latestVisualValidationReport.artifactId,
      iterations: [iteration],
      initialFindings: initialMajor.map((finding) => finding.findingId),
      resolvedFindings: resolved,
      unresolvedFindings: remaining,
      introducedFindings: introduced,
      finalStatus,
      stopReason,
      continuationAllowed,
      iterationLimit: requested.iterationPolicy.maxIterations,
      totalFilesChanged: application?.changedFiles?.length ?? 0,
      totalApprovals: 1,
      rollbacks: validation.status === "failed" ? 1 : 0,
      overallConfidence: fresh?.confidence ?? initial.confidence,
      correctionApplied: application !== undefined,
      projectValidation: validation.status,
      visualValidation: gate.status === "ready"
        ? { status: "completed" }
        : {
            status: "inconclusive",
            ...(gate.inconclusiveReason === undefined
              ? {}
              : { inconclusiveReason: gate.inconclusiveReason }),
          },
      ...(gate.inconclusiveReason === undefined
        ? {}
        : { visualValidationInconclusiveReason: gate.inconclusiveReason }),
      limitations: [
        "Each correction iteration is independently approved; continuation is allowed only when deterministic metrics improve without regression.",
      ],
      agent: {
        id: "visual-correction-agent",
        version: requested.agentVersion,
        modelProfileId: requested.modelProfileId,
      },
      traceIds: [],
    });
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.report,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.report,
      name: "Feedback Loop Report",
      payload: report,
      summary: {
        status: report.finalStatus,
        stopReason,
        resolved: resolved.length,
        remaining: remaining.length,
      },
    });
  },
};
export const storeFeedbackLoopIterationCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "store-feedback-loop-iteration",
  name: "Store feedback loop iteration",
  description:
    "Stores the immutable iteration record used by the final report.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const report = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.report,
      feedbackLoopReportV1Schema,
    );
    const iteration = report.iterations[report.iterations.length - 1];
    if (!iteration)
      throw new DesignFlowError(
        "ERR_ITERATION_MISSING",
        "Feedback loop report contains no iteration.",
      );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.iteration,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.iteration,
      name: "Feedback Loop Iteration",
      payload: iteration,
      summary: {
        iteration: iteration.iterationNumber,
        status: iteration.status,
        stopReason: iteration.stopReason ?? "none",
      },
    });
  },
};

export const storeStage6SummaryCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "store-stage-6-summary",
  name: "Store Stage 6 summary",
  description:
    "Stores the concise final feedback-loop status and safety counters.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const report = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.report,
      feedbackLoopReportV1Schema,
    );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.summary,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.summary,
      name: "Stage 6 Summary",
      payload: {
        schemaVersion: "1",
        projectId: report.projectId,
        finalStatus: report.finalStatus,
        stopReason: report.stopReason,
        iterations: report.iterations.length,
        approvals: report.totalApprovals,
        rollbacks: report.rollbacks,
        filesChanged: report.totalFilesChanged,
        resolvedFindings: report.resolvedFindings.length,
        unresolvedFindings: report.unresolvedFindings.length,
        noAutonomousApproval: true,
        noStage6FilesChangedDuringPlanning: true,
      },
      summary: {
        status: report.finalStatus,
        stopReason: report.stopReason,
        iterations: report.iterations.length,
      },
    });
  },
};

const baseFeedbackLoopCapabilities: readonly Capability<
  unknown,
  CapabilityOutput
>[] = [
  storeFeedbackLoopInputCapability,
  selectActionableFindingsCapability,
  prepareCorrectionContextCapability,
  invokeVisualCorrectionAgentCapability,
  storeCorrectionPlanCapability,
  storeProposedCorrectionChangesCapability,
  requestCorrectionApprovalCapability,
  createCorrectionSnapshotCapability,
  consumeCorrectionApprovalCapability,
  applyApprovedCorrectionCapability,
  validateCorrectionProjectCapability,
  evaluateFeedbackLoopCapability,
  storeFeedbackLoopIterationCapability,
  storeStage6SummaryCapability,
];

/** Production Stage 6 revalidation path; the inline report remains test-only. */
export const directStage5RevalidationCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "rerun-stage5-visual-validation",
  name: "Rerun Stage 5 visual validation",
  description:
    "Runs the existing Stage 5 browser, evidence, comparison, and report capabilities after mutation.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const requested = projectInput(
      await readArtifact(
        context,
        FEEDBACK_LOOP_ARTIFACT_IDS.input,
        inputSchema,
      ),
    );
    const validation = await readArtifact(
      context,
      FEEDBACK_LOOP_ARTIFACT_IDS.validation,
      projectValidationSchema,
    );
    if (validation.status !== "passed")
      return writeArtifact(context, {
        artifactId: "feedback-loop-revalidation-output",
        artifactType: "feedback.revalidation-gate",
        name: "Visual Revalidation Gate",
        payload: {
          status: "stopped",
          reason: "project_validation_failed",
          stage5ArtifactIds: [],
        },
        summary: { status: "stopped", reason: "project_validation_failed" },
      });
    const initial = await initialVisualReport(context, requested);
    let fresh;
    let stage5ArtifactIds: string[] = [];
    if (requested.revalidatedVisualValidationReport !== undefined) {
      fresh = visualValidationReportV1Schema.parse(
        requested.revalidatedVisualValidationReport,
      );
    } else {
      try {
        const result = await runFreshStage5Validation(
          context,
          requested,
          initial,
        );
        fresh = result.report;
        stage5ArtifactIds = result.artifactIds;
        if (
          objectHash(fresh) === requested.latestVisualValidationReport.artifactHash
        )
          return writeArtifact(context, {
            artifactId: "feedback-loop-revalidation-output",
            artifactType: "feedback.revalidation-gate",
            name: "Visual Revalidation Gate",
            payload: {
              status: "stopped",
              reason: "visual_validation_inconclusive",
              stage5ArtifactIds,
              referenceSource: result.referenceSource,
            },
            summary: {
              status: "stopped",
              reason: "visual_validation_inconclusive",
              referenceSource: result.referenceSource,
            },
          });
        return storeRevalidatedReport(
          context,
          fresh,
          stage5ArtifactIds,
          result.referenceSource,
        );
      } catch (error) {
        // Keep the persisted correction stop reason within the existing
        // typed contract; the bounded diagnostic carries the infrastructure
        // code and precise phase (for example ERR_MCP_TIMEOUT/acquisition).
        const reason = "visual_validation_inconclusive";
        const inconclusiveReason = visualValidationInconclusiveReason(error);
        const referenceSource = error instanceof Error && "referenceSource" in error &&
          ((error as { referenceSource?: unknown }).referenceSource === "persisted" ||
            (error as { referenceSource?: unknown }).referenceSource === "refreshed")
          ? (error as { referenceSource: "persisted" | "refreshed" }).referenceSource
          : "refreshed";
        return writeArtifact(context, {
          artifactId: "feedback-loop-revalidation-output",
          artifactType: "feedback.revalidation-gate",
          name: "Visual Revalidation Gate",
          payload: {
            status: "stopped",
            reason,
            stage5ArtifactIds,
            referenceSource,
            inconclusiveReason,
          },
          summary: {
            status: "stopped",
            reason,
            projectFilesChanged: true,
            referenceSource,
            inconclusiveReason,
          },
        });
      }
    }
    if (
      objectHash(fresh) === requested.latestVisualValidationReport.artifactHash
    )
      return writeArtifact(context, {
        artifactId: "feedback-loop-revalidation-gate",
        artifactType: "feedback.revalidation-gate",
        name: "Visual Revalidation Gate",
        payload: {
          status: "stopped",
          reason: "visual_validation_inconclusive",
          stage5ArtifactIds,
        },
        summary: {
          status: "stopped",
          reason: "visual_validation_inconclusive",
        },
      });
    return storeRevalidatedReport(context, fresh, stage5ArtifactIds);
  },
};

export const storeRevalidatedVisualValidationReportCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "store-revalidated-visual-validation-report",
  name: "Store revalidated Visual Validation Report",
  description:
    "Emits fresh Stage 5 output as a first-class persisted artifact.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const gate = await readArtifact(
      context,
      "feedback-loop-revalidation-gate",
      z
        .object({
          status: z.enum(["ready", "stopped"]),
          report: visualValidationReportV1Schema.optional(),
          reportArtifactId: z.string().optional(),
          stage5ArtifactIds: z.array(z.string()).default([]),
        })
        .strict(),
    );
    if (gate.status !== "ready" || gate.report === undefined)
      throw new DesignFlowError(
        "ERR_REVALIDATION_NOT_AVAILABLE",
        "A fresh Visual Validation Report is not available for persistence.",
      );
    return writeArtifact(context, {
      artifactId: FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport,
      artifactType: FEEDBACK_LOOP_ARTIFACT_TYPES.revalidatedReport,
      name: "Revalidated Visual Validation Report",
      payload: gate.report,
      summary: {
        status: gate.report.overallStatus,
        stage5ArtifactIds: gate.stage5ArtifactIds,
        projectFilesChanged: true,
      },
    });
  },
};

export const normalizeFeedbackLoopRevalidationGateCapability: Capability<
  unknown,
  CapabilityOutput
> = {
  id: "normalize-feedback-loop-revalidation-gate",
  name: "Normalize visual revalidation gate",
  description:
    "Preserves the stopped gate or emits a gate around the fresh report artifact for deterministic evaluation.",
  type: "pure",
  version: "1",
  inputSchema: z.unknown(),
  outputSchema: capabilityOutputSchema,
  async execute(context) {
    const gateSchema = z
      .object({
        status: z.enum(["ready", "stopped"]),
        reason: z.string().optional(),
        report: visualValidationReportV1Schema.optional(),
        reportArtifactId: z.string().optional(),
        stage5ArtifactIds: z.array(z.string()).default([]),
      })
      .passthrough();
    try {
      const gate = await readArtifact(context, "feedback-loop-revalidation-gate", gateSchema);
      return writeArtifact(context, {
        artifactId: "feedback-loop-revalidation-gate",
        artifactType: "feedback.revalidation-gate",
        name: "Visual Revalidation Gate",
        payload: gate,
        summary: {
          status: gate.status,
          ...(gate.reason !== undefined ? { reason: gate.reason } : {}),
          ...(gate.report !== undefined
            ? {
                reportStatus: gate.report.overallStatus,
                capturedViewports: gate.report.coverage.capturedViewports,
              }
            : {}),
          projectFilesChanged: true,
        },
      });
    } catch {
      let gate: z.infer<typeof gateSchema>;
      try {
        const storedGate = await readArtifact(context, "feedback-loop-revalidation-output", gateSchema);
        gate = { ...storedGate, stage5ArtifactIds: storedGate.stage5ArtifactIds ?? [] };
      } catch {
        const report = await readArtifact(
          context,
          FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport,
          visualValidationReportV1Schema,
        );
        gate = {
          status: "ready",
          report,
          reportArtifactId: FEEDBACK_LOOP_ARTIFACT_IDS.revalidatedReport,
          stage5ArtifactIds: [],
        };
      }
      return writeArtifact(context, {
        artifactId: "feedback-loop-revalidation-gate",
        artifactType: "feedback.revalidation-gate",
        name: "Visual Revalidation Gate",
        payload: gate,
        summary: {
          status: gate.status,
          ...(gate.reason !== undefined ? { reason: gate.reason } : {}),
          ...(gate.report !== undefined ? { reportStatus: gate.report.overallStatus, capturedViewports: gate.report.coverage.capturedViewports } : {}),
          projectFilesChanged: true,
        },
      });
    }
  },
};

export const feedbackLoopCapabilities: readonly Capability<
  unknown,
  CapabilityOutput
>[] = [
  ...baseFeedbackLoopCapabilities.slice(0, 11),
  directStage5RevalidationCapability,
  normalizeFeedbackLoopRevalidationGateCapability,
  ...baseFeedbackLoopCapabilities.slice(11),
];
