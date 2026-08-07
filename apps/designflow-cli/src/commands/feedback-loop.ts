import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  FEEDBACK_LOOP_WORKFLOW_ID,
  inspectRegisteredProject,
  parseFeedbackLoopInput,
  type CliContext,
} from "../services/cli-runner";
import {
  feedbackLoopParentRecordV1Schema,
  feedbackLoopParentIterationSchema,
  feedbackLoopParentReportV1Schema,
  terminateAtStage6Failpoint,
  type FeedbackLoopParentRecordV1,
  type FeedbackLoopParentReportV1,
} from "@designflow/sdk";
import type { Terminal } from "../ui/terminal";

function numberField(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : 0;
}

function stringArrayField(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

function objectField(
  value: unknown,
  key: string,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function artifactIdsFor(
  artifactIds: readonly string[],
  names: readonly string[],
): string[] {
  return artifactIds.filter((id) => names.some((name) => id.includes(name)));
}

async function buildParentIteration(
  context: CliContext,
  current: FeedbackInput,
  result: Awaited<ReturnType<typeof runCorrectionIteration>>,
  parentExecutionId: string,
): Promise<ReturnType<typeof feedbackLoopParentIterationSchema.parse>> {
  const childReport = await context.runner.explain(result.executionId);
  let artifactIds = childReport.artifacts.map(
    (artifact) => artifact.artifactId,
  );
  const nestedStage5Ids = [
    "preview-runtime-record",
    "implementation-screenshot-evidence",
    "dom-and-computed-style-evidence",
    "image-comparison-metrics",
  ];
  const nestedAvailable = await Promise.all(
    nestedStage5Ids.map(async (artifactId) =>
      (await context.artifactInspection.getPayloadByArtifactId(artifactId)) !==
      undefined
        ? artifactId
        : undefined,
    ),
  );
  artifactIds = [
    ...new Set([
      ...artifactIds,
      ...nestedAvailable.filter((id): id is string => id !== undefined),
      ...(
        typeof result.visualReportPayload === "object" &&
        result.visualReportPayload !== null &&
        !Array.isArray(result.visualReportPayload) &&
        Array.isArray(
          (result.visualReportPayload as Record<string, unknown>)
            .stage5ArtifactIds,
        )
          ? (
              (result.visualReportPayload as Record<string, unknown>)
                .stage5ArtifactIds as unknown[]
            ).filter((id): id is string => typeof id === "string")
          : []
      ),
      ...(typeof result.visualReportPayload === "object" &&
      result.visualReportPayload !== null &&
      !Array.isArray(result.visualReportPayload) &&
      Array.isArray(
        (result.visualReportPayload as Record<string, unknown>)
          .implementationEvidence,
      )
        ? ["implementation-screenshot-evidence", "image-comparison-metrics"]
        : []),
    ]),
  ];
  const payload = result.reportPayload ?? {};
  const childIteration = Array.isArray(payload.iterations)
    ? payload.iterations[0]
    : undefined;
  const proposalPayloads = await Promise.all(
    artifactIdsFor(artifactIds, [
      "correction-plan",
      "proposed-correction-changes",
    ]).map(async (artifactId) =>
      context.artifactInspection.getPayloadByArtifactId(artifactId),
    ),
  );
  const resolved = stringArrayField(childIteration, "findingsResolved");
  const remaining = stringArrayField(childIteration, "findingsRemaining");
  const introduced = stringArrayField(childIteration, "findingsIntroduced");
  const screenshotArtifact = artifactIdsFor(artifactIds, [
    "implementation-screenshot-evidence",
  ])[0];
  const screenshotPayload =
    screenshotArtifact === undefined
      ? undefined
      : await context.artifactInspection.getPayloadByArtifactId(
          screenshotArtifact,
        );
  const screenshotCaptureCounts: Record<string, number> = {};
  const screenshotEvidence =
    typeof screenshotPayload === "object" &&
    screenshotPayload !== null &&
    !Array.isArray(screenshotPayload) &&
    Array.isArray((screenshotPayload as Record<string, unknown>).evidence)
      ? ((screenshotPayload as Record<string, unknown>).evidence as unknown[])
      : typeof result.visualReportPayload === "object" &&
          result.visualReportPayload !== null &&
          !Array.isArray(result.visualReportPayload) &&
          Array.isArray(
            (result.visualReportPayload as Record<string, unknown>)
              .implementationEvidence,
          )
        ? ((result.visualReportPayload as Record<string, unknown>)
            .implementationEvidence as unknown[])
        : [];
  for (const item of screenshotEvidence) {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      continue;
    const viewport = objectField(item, "viewport");
    const viewportId = viewport?.id;
    if (typeof viewportId === "string")
      screenshotCaptureCounts[viewportId] =
        (screenshotCaptureCounts[viewportId] ?? 0) + 1;
  }
  const status =
    result.status === "rejected"
      ? "rejected"
      : payload.finalStatus === "pass" ||
          payload.finalStatus === "pass_with_findings"
        ? "completed"
        : payload.stopReason === "project_validation_failed"
          ? "rolled_back"
          : "stopped";
  return feedbackLoopParentIterationSchema.parse({
    iterationId: `${result.executionId}:${current.iterationNumber}`,
    parentExecutionId,
    iterationNumber: current.iterationNumber,
    childExecutionId: result.executionId,
    inputVisualReportHash: current.latestVisualValidationReport.artifactHash,
    inputProjectFingerprint: current.projectFingerprint,
    correctionProposalHash: hashObject(proposalPayloads),
    proposalArtifactIds: artifactIdsFor(artifactIds, [
      "correction-plan",
      "proposed-correction-changes",
      "correction-agent-output",
    ]),
    approvalIds: result.approvalId === undefined ? [] : [result.approvalId],
    approvalConsumptionArtifactIds: artifactIdsFor(artifactIds, [
      "consumed-correction-approval",
    ]),
    snapshotArtifactIds: artifactIdsFor(artifactIds, ["correction-snapshot"]),
    applicationArtifactIds: artifactIdsFor(artifactIds, [
      "correction-application-result",
    ]),
    validationArtifactIds: artifactIdsFor(artifactIds, [
      "correction-project-validation",
    ]),
    rollbackArtifactIds: artifactIdsFor(artifactIds, [
      "correction-rollback-result",
    ]),
    previewArtifactIds: artifactIdsFor(artifactIds, ["preview-runtime-record"]),
    screenshotEvidenceArtifactIds: artifactIdsFor(artifactIds, [
      "implementation-screenshot-evidence",
    ]),
    domEvidenceArtifactIds: artifactIdsFor(artifactIds, [
      "dom-and-computed-style-evidence",
    ]),
    comparisonArtifactIds: artifactIdsFor(artifactIds, [
      "image-comparison-metrics",
    ]),
    evaluationArtifactIds: artifactIdsFor(artifactIds, [
      "feedback-loop-report",
      "feedback-loop-iteration",
    ]),
    visualReportArtifactIds: artifactIdsFor(artifactIds, [
      "revalidated-visual-validation-report",
      "visual-validation-report",
    ]),
    status,
    ...(typeof payload.stopReason === "string"
      ? { stopReason: payload.stopReason }
      : {}),
    resolvedFindings: resolved,
    remainingFindings: remaining,
    introducedFindings: introduced,
    screenshotCaptureCounts,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  });
}

function parentReportFrom(
  record: FeedbackLoopParentRecordV1,
): FeedbackLoopParentReportV1 {
  return feedbackLoopParentReportV1Schema.parse({
    schemaVersion: "1",
    parentExecutionId: record.parentExecutionId,
    projectId: record.projectId,
    initialVisualReportId: record.initialVisualReport.artifactId,
    finalVisualReportId: record.currentVisualReport.artifactId,
    childIterationIds: record.iterations.map(
      (iteration) => iteration.iterationId,
    ),
    iterations: record.iterations,
    proposalArtifactIds: record.iterations.flatMap(
      (iteration) => iteration.proposalArtifactIds,
    ),
    approvalIds: record.iterations.flatMap(
      (iteration) => iteration.approvalIds,
    ),
    snapshotArtifactIds: record.iterations.flatMap(
      (iteration) => iteration.snapshotArtifactIds,
    ),
    applicationArtifactIds: record.iterations.flatMap(
      (iteration) => iteration.applicationArtifactIds,
    ),
    validationArtifactIds: record.iterations.flatMap(
      (iteration) => iteration.validationArtifactIds,
    ),
    rollbackArtifactIds: record.iterations.flatMap(
      (iteration) => iteration.rollbackArtifactIds,
    ),
    visualReportArtifactIds: record.iterations.flatMap(
      (iteration) => iteration.visualReportArtifactIds,
    ),
    sideEffectCounts: record.sideEffectCounts,
    resolvedFindings: record.resolvedFindings,
    remainingFindings: record.remainingFindings,
    introducedFindings: record.introducedFindings,
    totalApprovals: record.iterations.reduce(
      (count, iteration) => count + iteration.approvalIds.length,
      0,
    ),
    totalFilesChanged: record.cumulativeFileChanges.length,
    rollbackCount: record.rollbackCount,
    finalStatus: record.finalStatus ?? "stopped",
    stopReason: record.stopReason ?? "aborted",
    iterationLimit: record.maxIterations,
    limitations: [
      "Parent state is persisted atomically with the CLI execution store; child side effects remain governed by the existing workflow transaction and snapshot boundaries.",
    ],
    traceIds: record.traceIds,
    createdAt: record.createdAt,
  });
}

function appendCompletedSideEffects(
  parent: FeedbackLoopParentRecordV1,
  current: FeedbackInput,
  iteration: ReturnType<typeof feedbackLoopParentIterationSchema.parse>,
): FeedbackLoopParentRecordV1["sideEffects"] {
  const nodeFor = (artifactId: string): string =>
    artifactId.includes("consumed-correction-approval")
      ? "consume-correction-approval"
      : artifactId.includes("snapshot")
      ? "create-correction-snapshot"
      : artifactId.includes("application")
        ? "apply-approved-correction"
        : artifactId.includes("validation")
          ? "run-correction-project-validation"
          : artifactId.includes("rollback")
            ? "rollback-correction"
            : artifactId.includes("preview")
              ? "start-preview-server"
              : artifactId.includes("visual")
                ? "rerun-stage5-visual-validation"
                : "evaluate-feedback-loop";
  const artifacts = [
    ...iteration.approvalConsumptionArtifactIds,
    ...iteration.snapshotArtifactIds,
    ...iteration.applicationArtifactIds,
    ...iteration.validationArtifactIds,
    ...iteration.rollbackArtifactIds,
    ...iteration.previewArtifactIds,
    ...iteration.screenshotEvidenceArtifactIds,
    ...iteration.domEvidenceArtifactIds,
    ...iteration.comparisonArtifactIds,
    ...iteration.evaluationArtifactIds,
    ...iteration.visualReportArtifactIds,
  ];
  const childRecordId = `${parent.parentExecutionId}:child:${current.iterationNumber}`;
  const effects = parent.sideEffects.map((effect) =>
    effect.recordId === childRecordId
      ? {
          ...effect,
          childExecutionId: iteration.childExecutionId,
          completionIdentity: hashObject(iteration),
          status: "completed" as const,
          completedAt: iteration.endedAt,
        }
      : effect.nodeId === "request-correction-approval" &&
          effect.iterationNumber === current.iterationNumber &&
          iteration.approvalIds.some((approvalId) =>
            effect.artifactIds.includes(approvalId),
          )
        ? {
            ...effect,
            status: "completed" as const,
            completionIdentity: hashObject(iteration),
            completedAt: iteration.endedAt,
          }
        : effect,
  );
  for (const artifactId of artifacts) {
    const recordId = `${parent.parentExecutionId}:${current.iterationNumber}:${artifactId}`;
    if (effects.some((effect) => effect.recordId === recordId)) continue;
    effects.push({
      recordId,
      parentExecutionId: parent.parentExecutionId,
      childExecutionId: iteration.childExecutionId,
      iterationNumber: current.iterationNumber,
      nodeId: nodeFor(artifactId),
      inputIdentity: current.latestVisualValidationReport.artifactHash,
      completionIdentity: hashObject(iteration),
      status: "completed",
      artifactIds: [artifactId],
      startedAt: iteration.startedAt,
      completedAt: iteration.endedAt,
    });
  }
  return effects;
}

function addIterationCounts(
  parent: FeedbackLoopParentRecordV1,
  iteration: ReturnType<typeof feedbackLoopParentIterationSchema.parse>,
): FeedbackLoopParentRecordV1["sideEffectCounts"] {
  const add = (left: number, right: number): number => left + right;
  const screenshotCaptureByViewport = { ...parent.sideEffectCounts.screenshotCaptureByViewport };
  for (const [viewport, count] of Object.entries(iteration.screenshotCaptureCounts))
    screenshotCaptureByViewport[viewport] = add(
      screenshotCaptureByViewport[viewport] ?? 0,
      typeof count === "number" ? count : 0,
    );
  return {
    ...parent.sideEffectCounts,
    childCreation: parent.sideEffectCounts.childCreation + 1,
    approvalConsumption: add(
      parent.sideEffectCounts.approvalConsumption,
      iteration.approvalConsumptionArtifactIds.length,
    ),
    snapshotCreation: add(
      parent.sideEffectCounts.snapshotCreation,
      iteration.snapshotArtifactIds.length,
    ),
    correctionApplication: add(
      parent.sideEffectCounts.correctionApplication,
      iteration.applicationArtifactIds.length,
    ),
    rollback: add(parent.sideEffectCounts.rollback, iteration.rollbackArtifactIds.length),
    projectValidation: add(
      parent.sideEffectCounts.projectValidation,
      iteration.validationArtifactIds.length,
    ),
    previewLaunch: add(parent.sideEffectCounts.previewLaunch, iteration.previewArtifactIds.length),
    screenshotCaptureByViewport,
    domStyleCollection: add(
      parent.sideEffectCounts.domStyleCollection,
      iteration.domEvidenceArtifactIds.length,
    ),
    imageComparison: add(
      parent.sideEffectCounts.imageComparison,
      iteration.comparisonArtifactIds.length,
    ),
    visualReportCreation: add(
      parent.sideEffectCounts.visualReportCreation,
      iteration.visualReportArtifactIds.length,
    ),
    iterationEvaluation: add(
      parent.sideEffectCounts.iterationEvaluation,
      iteration.evaluationArtifactIds.length > 0 ? 1 : 0,
    ),
  };
}

async function finalizeParent(
  context: CliContext,
  record: FeedbackLoopParentRecordV1,
  finalStatus: "pass" | "pass_with_findings" | "fail" | "stopped",
  stopReason: string,
): Promise<FeedbackLoopParentRecordV1> {
  const latest = await context.feedbackLoopParents.get(record.parentExecutionId);
  if (latest === null) throw new Error(`Feedback loop parent not found: ${record.parentExecutionId}`);
  if (latest.finalReport !== undefined) return latest;
  const staged = await updateParent(context, record.parentExecutionId, {
    state:
      finalStatus === "pass" || finalStatus === "pass_with_findings"
        ? "completed"
        : "stopped",
    finalStatus,
    stopReason,
  });
  terminateAtStage6Failpoint("after_parent_stop_persisted");
  const report = parentReportFrom(staged);
  const reportArtifactId = parentReportArtifactId(staged.parentExecutionId);
  const payloadRef = await context.artifactStore.save(report, {
    artifactId: reportArtifactId,
    name: "Feedback Loop Parent Report",
    parentExecutionId: staged.parentExecutionId,
  });
  if ((await context.artifactStore.getArtifact(reportArtifactId)) === null) {
    await context.artifactStore.createArtifact({
      id: reportArtifactId,
      type: "feedback.parent-report",
      metadata: {
        payloadId: payloadRef.id,
        parentExecutionId: staged.parentExecutionId,
      },
    });
  }
  return await updateParent(context, staged.parentExecutionId, {
    finalReportArtifactId: reportArtifactId,
    finalReportHash: payloadRef.id,
    sideEffectCounts: {
      ...staged.sideEffectCounts,
      finalReportCreation: staged.sideEffectCounts.finalReportCreation + 1,
    },
    finalReport: report as unknown as Record<string, unknown>,
  });
}

function countField(value: unknown, key: string): number {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate) ? candidate.length : numberField(value, key);
}

function arrayField(value: unknown, key: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [];
  const candidate = (value as Record<string, unknown>)[key];
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

function mappingOutcomes(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [];
  const candidate = (value as Record<string, unknown>)[
    "findingToChangeMapping"
  ];
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return [];
    const outcome = (item as Record<string, unknown>)["expectedOutcome"];
    return typeof outcome === "string" ? [outcome] : [];
  });
}

function changePreviews(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [];
  const candidate = (value as Record<string, unknown>)["changes"];
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item))
      return [];
    const record = item as Record<string, unknown>;
    const path =
      typeof record["relativePath"] === "string"
        ? record["relativePath"]
        : "unknown";
    const content =
      typeof record["proposedContent"] === "string"
        ? record["proposedContent"].slice(0, 400)
        : "";
    return [`--- ${path}`, `+++ ${path}`, content];
  });
}

function readInput(path: string): unknown {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return parseFeedbackLoopInput(raw);
}

function hashObject(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

type FeedbackInput = ReturnType<typeof parseFeedbackLoopInput>;

const PARENT_REPORT_ARTIFACT_ID = "feedback-loop-parent-report";

function parentReportArtifactId(parentExecutionId: string): string {
  return `${PARENT_REPORT_ARTIFACT_ID}:${parentExecutionId}`;
}

function parentIdFor(input: FeedbackInput): string {
  return `feedback-loop-parent-${input.executionId}`;
}

function parentArtifact(artifactId: string, artifactHash: string) {
  return { artifactId, artifactHash, version: "1" };
}

export async function createOrLoadParent(
  context: CliContext,
  input: FeedbackInput,
): Promise<FeedbackLoopParentRecordV1> {
  const parentId = parentIdFor(input);
  const existing = await context.feedbackLoopParents.get(parentId);
  if (existing !== null) return existing;
  const now = new Date().toISOString();
  const record = feedbackLoopParentRecordV1Schema.parse({
    schemaVersion: "1",
    parentExecutionId: parentId,
    workflowId: FEEDBACK_LOOP_WORKFLOW_ID,
    state: "created",
    projectId: input.project.id,
    canonicalRootIdentity: input.project.canonicalRootIdentity,
    initialProjectFingerprint: input.projectFingerprint,
    currentProjectFingerprint: input.projectFingerprint,
    initialImplementationHash: input.currentImplementationHash,
    currentImplementationHash: input.currentImplementationHash,
    initialVisualReport: input.latestVisualValidationReport,
    currentVisualReport: input.latestVisualValidationReport,
    input: input as unknown as Record<string, unknown>,
    iterationPolicy: input.iterationPolicy as unknown as Record<
      string,
      unknown
    >,
    currentIterationNumber: 0,
    maxIterations: input.iterationPolicy.maxIterations,
    childExecutionIds: [],
    iterations: [],
    resolvedFindings: [],
    remainingFindings: input.actionableFindingIds,
    introducedFindings: [],
    cumulativeFileChanges: [],
    rollbackCount: 0,
    sideEffectCounts: {
      childCreation: 0,
      approvalConsumption: 0,
      snapshotCreation: 0,
      correctionApplication: 0,
      rollback: 0,
      projectValidation: 0,
      previewLaunch: 0,
      screenshotCaptureByViewport: {},
      domStyleCollection: 0,
      imageComparison: 0,
      visualReportCreation: 0,
      iterationEvaluation: 0,
      finalReportCreation: 0,
    },
    sideEffects: [],
    traceIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await context.feedbackLoopParents.create(record);
  return record;
}

async function updateParent(
  context: CliContext,
  parentId: string,
  patch: Partial<Omit<FeedbackLoopParentRecordV1, "parentExecutionId">>,
): Promise<FeedbackLoopParentRecordV1> {
  const updated = await context.feedbackLoopParents.update(parentId, {
    ...patch,
    updatedAt: new Date().toISOString(),
  });
  if (updated === null)
    throw new Error(`Feedback loop parent not found: ${parentId}`);
  return updated;
}

async function runCorrectionIteration(
  context: CliContext,
  terminal: Terminal,
  input: FeedbackInput,
  existingExecutionId?: string,
  existingApprovalId?: string,
  hooks?: {
    onStarted?: (executionId: string) => Promise<void>;
    onPendingApproval?: (
      executionId: string,
      approvalId: string,
    ) => Promise<void>;
    onApproved?: (executionId: string) => Promise<void>;
  },
): Promise<{
  executionId: string;
  status: string;
  approvalId?: string;
  reportPayload?: Record<string, unknown>;
  visualReportPayload?: Record<string, unknown>;
}> {
  const iteration = input.iterationNumber;
  const limit = input.iterationPolicy.maxIterations;
  terminal.print(`Preparing correction iteration ${iteration} of ${limit}…`);
  const executionId =
    existingExecutionId ??
    (
      await context.runner.start({
        workflowId: FEEDBACK_LOOP_WORKFLOW_ID,
        input,
      })
      ).executionId;
  await hooks?.onStarted?.(executionId);
  const pending = await context.runner.pendingApproval(executionId);
  if (pending !== null) {
    await hooks?.onPendingApproval?.(executionId, pending.approvalId);
    const report = await context.runner.explain(executionId);
    const plan = report.artifacts.find(
      (artifact) => artifact.artifactId === "correction-plan",
    );
    const changes = report.artifacts.find(
      (artifact) => artifact.artifactId === "proposed-correction-changes",
    );
    const planPayload =
      plan === undefined
        ? undefined
        : (await context.artifactInspection.getPayload(plan)).payload;
    const changesPayload =
      changes === undefined
        ? undefined
        : (await context.artifactInspection.getPayload(changes)).payload;
    terminal.print();
    terminal.print("Correction proposal");
    terminal.print("──────────────────────────────────────────────");
    terminal.print(`Iteration: ${iteration} of ${limit}`);
    terminal.print(
      `Findings: ${countField(planPayload, "selectedFindingIds") || numberField(planPayload, "findings")}`,
    );
    terminal.print(`Files modified: ${countField(changesPayload, "changes")}`);
    terminal.print(
      `Dependencies: ${numberField(changesPayload, "dependencyCount")}`,
    );
    terminal.print();
    terminal.print("Files to modify:");
    for (const path of arrayField(planPayload, "filesExpectedToChange"))
      terminal.print(`- ${path}`);
    terminal.print();
    terminal.print("Expected result:");
    for (const outcome of mappingOutcomes(planPayload))
      terminal.print(`- ${outcome}`);
    terminal.print();
    terminal.print("Validation:");
    for (const command of arrayField(planPayload, "validationCommands"))
      terminal.print(`- ${command}`);
    terminal.print("- visual validation at desktop, tablet, mobile");
    terminal.print(
      "- one snapshot before apply; rollback on required validation failure",
    );
    terminal.print();
    terminal.print("Bounded diff:");
    for (const line of changePreviews(changesPayload)) terminal.print(line);
    terminal.print();
    terminal.print("No files have been changed yet.");
    terminal.print();
    const answer = await terminal.ask(
      "Approve these exact correction changes?",
      ["approve", "reject"],
    );
    if (!answer.trim().toLowerCase().startsWith("a")) {
      await context.runner.reject(executionId, "rejected from the Stage 6 CLI");
      terminal.print("Feedback loop stopped.");
      terminal.print("Status: rejected");
      terminal.print("No further files were changed.");
      return {
        executionId,
        status: "rejected",
        approvalId: pending.approvalId,
      };
    }
    await hooks?.onApproved?.(executionId);
    await context.runner.approve(
      executionId,
      `approved from the Stage 6 CLI iteration ${iteration}`,
    );
  }

  let finalReport = await context.runner.explain(executionId);
  if (
    finalReport.overview.state === "running" ||
    (existingApprovalId !== undefined &&
      finalReport.overview.state === "needs_approval")
  ) {
    const resumed =
      existingApprovalId === undefined
        ? existingExecutionId === undefined
          ? await context.runner.resumeLatest(FEEDBACK_LOOP_WORKFLOW_ID)
          : await context.runner.resumeConsumedApproval(existingExecutionId)
        : await context.runner.resumeApproved(existingApprovalId);
    if (resumed.executionId !== executionId) {
      throw new Error(
        `Feedback loop child identity changed while resuming: expected ${executionId}, received ${resumed.executionId}`,
      );
    }
    finalReport = await context.runner.explain(executionId);
  }
  const feedbackReportArtifact = finalReport.artifacts.find(
    (artifact) => artifact.artifactId === "feedback-loop-report",
  );
  const feedbackPayload =
    feedbackReportArtifact === undefined
      ? undefined
      : (await context.artifactInspection.getPayload(feedbackReportArtifact))
          .payload;
  const visualReportArtifact = finalReport.artifacts.find(
    (artifact) =>
      artifact.artifactId === "revalidated-visual-validation-report",
  );
  const visualPayload =
    visualReportArtifact === undefined
      ? undefined
      : (await context.artifactInspection.getPayload(visualReportArtifact))
          .payload;
  let status: string = finalReport.overview.state;
  let reportPayload: Record<string, unknown> | undefined;
  if (
    typeof feedbackPayload === "object" &&
    feedbackPayload !== null &&
    !Array.isArray(feedbackPayload)
  ) {
    reportPayload = feedbackPayload as Record<string, unknown>;
    if (typeof reportPayload.finalStatus === "string")
      status = reportPayload.finalStatus;
  } else if (feedbackReportArtifact === undefined) {
    const selectionArtifact = finalReport.artifacts.find(
      (artifact) => artifact.artifactId === "actionable-finding-selection",
    );
    const selectionPayload =
      selectionArtifact === undefined
        ? undefined
        : (await context.artifactInspection.getPayload(selectionArtifact))
            .payload;
    const stopReason =
      typeof selectionPayload === "object" &&
      selectionPayload !== null &&
      !Array.isArray(selectionPayload)
        ? (selectionPayload as Record<string, unknown>).stopReason
        : undefined;
    if (typeof stopReason === "string") status = stopReason;
  }
  terminal.print();
  terminal.print("Correction iteration finished.");
  terminal.print(`Run ID: ${executionId}`);
  terminal.print(`Status: ${status}`);
  if (finalReport.overview.failureReason !== undefined)
    terminal.print(`Reason: ${finalReport.overview.failureReason}`);
  terminal.print(`Artifacts: ${finalReport.artifacts.length}`);
  return {
    executionId,
    status,
    ...(pending?.approvalId !== undefined
      ? { approvalId: pending.approvalId }
      : {}),
    ...(reportPayload !== undefined ? { reportPayload } : {}),
    ...(typeof visualPayload === "object" &&
    visualPayload !== null &&
    !Array.isArray(visualPayload)
      ? { visualReportPayload: visualPayload as Record<string, unknown> }
      : {}),
  };
}

export async function feedbackLoopCommand(
  context: CliContext,
  terminal: Terminal,
  inputPath: string | undefined,
  parentCommand: "show" | "resume" | "stop" | undefined = undefined,
  parentId: string | undefined = undefined,
): Promise<number> {
  if (parentCommand !== undefined) {
    if (parentId === undefined) {
      terminal.print("Provide a feedback loop parent run id.");
      return 1;
    }
    const parent = await context.feedbackLoopParents.get(parentId);
    if (parent === null) {
      terminal.print(`No feedback loop parent with id ${parentId}.`);
      return 1;
    }
    if (parentCommand === "show") {
      terminal.print("Feedback loop");
      terminal.print("──────────────────────────────────────────────");
      terminal.print(`Parent run: ${parent.parentExecutionId}`);
      terminal.print(`Status: ${parent.state}`);
      terminal.print(
        `Iteration: ${parent.currentIterationNumber} of ${parent.maxIterations}`,
      );
      terminal.print(`Completed iterations: ${parent.iterations.length}`);
      terminal.print(`Child IDs: ${parent.childExecutionIds.join(", ") || "none"}`);
      terminal.print(`Pending boundary: ${parent.state}`);
      terminal.print(`Completed side effects: ${parent.sideEffects.filter((effect) => effect.status === "completed").length}`);
      terminal.print(
        `Next permitted action: ${
          parent.state === "waiting_approval"
            ? "approve or reject the exact proposal"
            : parent.state === "waiting_next_iteration"
              ? "continue preparing or stop"
              : parent.state === "completed" || parent.state === "stopped"
                ? "inspect the stable final report"
                : "resume the persisted boundary"
        }`,
      );
      terminal.print(
        `Remaining major findings: ${parent.remainingFindings.length}`,
      );
      if (parent.finalReportArtifactId !== undefined)
        terminal.print(`Final report: ${parent.finalReportArtifactId}`);
      return 0;
    }
    if (parentCommand === "stop") {
      if (parent.state === "completed" || parent.state === "stopped") {
        terminal.print(`Feedback loop already ${parent.state}.`);
        return parent.finalStatus === "pass" ||
          parent.finalStatus === "pass_with_findings"
          ? 0
          : 1;
      }
      const childExecutionId = parent.childExecutionIds.at(-1);
      if (childExecutionId !== undefined) {
        const pending = await context.runner.pendingApproval(childExecutionId);
        if (pending !== null)
          await context.runner.reject(
            childExecutionId,
            "feedback loop parent stopped",
          );
      }
      await finalizeParent(context, parent, "stopped", "aborted");
      terminal.print("Feedback loop stopped.");
      terminal.print("Status: aborted");
      terminal.print("No further files were changed.");
      return 1;
    }
    if (parent.finalReport !== undefined) {
      terminal.print(
        `Feedback loop already completed: ${parent.finalReportArtifactId ?? PARENT_REPORT_ARTIFACT_ID}`,
      );
      terminal.print(`Status: ${parent.finalStatus ?? "stopped"}`);
      return parent.finalStatus === "pass" ||
        parent.finalStatus === "pass_with_findings"
        ? 0
        : 1;
    }
    terminal.print(
      `Resuming parent ${parent.parentExecutionId} from ${parent.state}.`,
    );
    terminal.print("Completed actions will not be repeated.");
    return runParentLoop(context, terminal, parent);
  }
  if (inputPath === undefined) {
    terminal.print("Provide a bounded Stage 6 input JSON file:");
    terminal.print("  designflow feedback-loop --input <path>");
    return 1;
  }
  let input: ReturnType<typeof parseFeedbackLoopInput>;
  try {
    input = readInput(inputPath) as ReturnType<typeof parseFeedbackLoopInput>;
    if (input.initialVisualValidationReport === undefined) {
      const payload = await context.artifactInspection.getPayloadByArtifactId(
        input.latestVisualValidationReport.artifactId,
      );
      if (payload !== undefined)
        input = parseFeedbackLoopInput({
          ...input,
          initialVisualValidationReport: payload,
        });
    }
  } catch {
    terminal.print("The Stage 6 input file is invalid or could not be read.");
    return 1;
  }

  return runParentLoop(
    context,
    terminal,
    await createOrLoadParent(context, input),
  );
}

export async function runParentLoop(
  context: CliContext,
  terminal: Terminal,
  initialParent: FeedbackLoopParentRecordV1,
): Promise<number> {
  let parent = initialParent;
  let current = parseFeedbackLoopInput(parent.input);
  terminal.print("Visual correction (Beta)");
  terminal.print("──────────────────────────────────────────────");
  while (true) {
    // Root cancellation: an interrupted loop starts no further iteration.
    // The parent record already persists the state the active child reached
    // (the runner recorded the child as cancelled), so the loop simply stops
    // here and the existing resume path picks up from durable state later.
    if (isRootCancellationRequested(context)) {
      if (parent.finalReport === undefined) {
        parent = await finalizeParent(context, parent, "stopped", "aborted");
        printCorrectionSummary(terminal, parent);
      }
      terminal.print("Correction loop interrupted — no further iteration will start.");
      terminal.print(`Parent run: ${parent.parentExecutionId}`);
      return 1;
    }
    if (parent.finalReport !== undefined) {
      const status = parent.finalStatus ?? "stopped";
      terminal.print(`Parent run: ${parent.parentExecutionId}`);
      terminal.print(`Status: ${status}`);
      return status === "pass" || status === "pass_with_findings" ? 0 : 1;
    }
    if (
      parent.finalStatus !== undefined &&
      (parent.state === "completed" ||
        parent.state === "stopped" ||
        parent.state === "failed")
    ) {
      parent = await finalizeParent(
        context,
        parent,
        parent.finalStatus,
        parent.stopReason ?? "aborted",
      );
      printCorrectionSummary(terminal, parent);
      return parent.finalStatus === "pass" ||
        parent.finalStatus === "pass_with_findings"
        ? 0
        : 1;
    }
    const observed = inspectRegisteredProject(current.project);
    if (
      parent.state !== "created" &&
      parent.state !== "applying_correction" &&
      parent.state !== "validating_project" &&
      parent.state !== "revalidating_visuals" &&
      parent.state !== "evaluating_iteration" &&
      observed.project.contextFingerprint !== parent.currentProjectFingerprint
    ) {
      parent = await finalizeParent(context, parent, "stopped", "stale_state");
      printCorrectionSummary(terminal, parent);
      terminal.print("Feedback loop stopped.");
      terminal.print("Status: stale_state");
      terminal.print("No further files were changed.");
      return 1;
    }
    let existingChild =
      parent.state === "waiting_approval" ||
      parent.state === "preparing_iteration" ||
      parent.state === "applying_correction" ||
      parent.state === "validating_project" ||
      parent.state === "revalidating_visuals" ||
      parent.state === "evaluating_iteration"
        ? parent.sideEffects.find(
            (effect) =>
              effect.nodeId === "child-execution" &&
              effect.iterationNumber === current.iterationNumber,
          )?.childExecutionId ??
          parent.sideEffects.find(
            (effect) =>
              effect.nodeId === "request-correction-approval" &&
              effect.iterationNumber === current.iterationNumber,
          )?.childExecutionId
        : undefined;
    if (
      existingChild === undefined &&
      parent.state === "preparing_iteration" &&
      current.iterationNumber === 1
    ) {
      const history = await context.runner.history(FEEDBACK_LOOP_WORKFLOW_ID);
      const recovered = history[0]?.executionId;
      if (recovered !== undefined) {
        existingChild = recovered;
        parent = await updateParent(context, parent.parentExecutionId, {
          childExecutionIds: [...parent.childExecutionIds, recovered],
        });
      }
    }
    if (parent.state === "waiting_next_iteration") {
      const answer = await terminal.ask(
        `Correction improved the implementation.\n${parent.remainingFindings.length} major finding remains.\n\nPrepare correction iteration ${parent.currentIterationNumber + 1} of ${parent.maxIterations}?`,
        ["yes", "stop"],
      );
      if (!answer.trim().toLowerCase().startsWith("y")) {
        parent = await finalizeParent(context, parent, "stopped", "aborted");
        printCorrectionSummary(terminal, parent);
        terminal.print("Feedback loop stopped.");
        terminal.print("Status: aborted");
        terminal.print("No further files were changed.");
        return 1;
      }
      const inspected = inspectRegisteredProject(current.project);
      const freshPayload =
        parent.finalReport === undefined &&
        parent.currentVisualReport.artifactId ===
          "revalidated-visual-validation-report"
          ? await context.artifactInspection.getPayloadByArtifactId(
              parent.currentVisualReport.artifactId,
            )
          : undefined;
      current = parseFeedbackLoopInput({
        ...current,
        executionId: `${current.executionId}-iteration-${parent.currentIterationNumber + 1}`,
        iterationNumber: parent.currentIterationNumber + 1,
        projectFingerprint: inspected.project.contextFingerprint,
        currentImplementationHash: hashObject(inspected),
        latestVisualValidationReport: parent.currentVisualReport,
        ...(freshPayload !== undefined
          ? { initialVisualValidationReport: freshPayload }
          : {}),
      });
      parent = await updateParent(context, parent.parentExecutionId, {
        state: "preparing_iteration",
        currentIterationNumber: current.iterationNumber,
        currentProjectFingerprint: current.projectFingerprint,
        currentImplementationHash: current.currentImplementationHash,
        input: current as unknown as Record<string, unknown>,
      });
      continue;
    }
    parent = await updateParent(context, parent.parentExecutionId, {
      state: "preparing_iteration",
      currentIterationNumber: current.iterationNumber,
    });
    const childCreationRecordId = `${parent.parentExecutionId}:child:${current.iterationNumber}`;
    if (
      !parent.sideEffects.some(
        (effect) => effect.recordId === childCreationRecordId,
      )
    ) {
      parent = await updateParent(context, parent.parentExecutionId, {
        sideEffects: [
          ...parent.sideEffects,
          {
            recordId: childCreationRecordId,
            parentExecutionId: parent.parentExecutionId,
            iterationNumber: current.iterationNumber,
            nodeId: "child-execution",
            inputIdentity: current.latestVisualValidationReport.artifactHash,
            status: "pending",
            artifactIds: [],
            startedAt: new Date().toISOString(),
          },
        ],
      });
    }
    const existingApprovalId = parent.sideEffects
      .filter(
        (effect) =>
          effect.iterationNumber === current.iterationNumber &&
          effect.nodeId === "request-correction-approval",
      )
      .flatMap((effect) => effect.artifactIds)
      .find((artifactId) => artifactId !== "correction-approval-binding");
    const result = await runCorrectionIteration(
      context,
      terminal,
      current,
      existingChild,
      existingApprovalId,
      {
        onStarted: async (executionId) => {
          parent = await updateParent(context, parent.parentExecutionId, {
            childExecutionIds: parent.childExecutionIds.includes(executionId)
              ? parent.childExecutionIds
              : [...parent.childExecutionIds, executionId],
            sideEffects: parent.sideEffects.map((effect) =>
              effect.recordId ===
                `${parent.parentExecutionId}:child:${current.iterationNumber}`
                ? { ...effect, childExecutionId: executionId }
                : effect,
            ),
          });
        },
        onPendingApproval: async (executionId, approvalId) => {
          const recordId = `${parent.parentExecutionId}:approval:${current.iterationNumber}`;
          parent = await updateParent(context, parent.parentExecutionId, {
            state: "waiting_approval",
            childExecutionIds: parent.childExecutionIds.includes(executionId)
              ? parent.childExecutionIds
              : [...parent.childExecutionIds, executionId],
            sideEffects: parent.sideEffects.some(
              (effect) => effect.recordId === recordId,
            )
              ? parent.sideEffects
              : [
                  ...parent.sideEffects,
                  {
                    recordId,
                    parentExecutionId: parent.parentExecutionId,
                    childExecutionId: executionId,
                    iterationNumber: current.iterationNumber,
                    nodeId: "request-correction-approval",
                    inputIdentity:
                      current.latestVisualValidationReport.artifactHash,
                    status: "pending",
                    artifactIds: ["correction-approval-binding", approvalId],
                    startedAt: new Date().toISOString(),
                  },
                ],
          });
        },
        onApproved: async (executionId) => {
          parent = await updateParent(context, parent.parentExecutionId, {
            state: "applying_correction",
            childExecutionIds: parent.childExecutionIds.includes(executionId)
              ? parent.childExecutionIds
              : [...parent.childExecutionIds, executionId],
          });
        },
      },
    );
    if (!parent.childExecutionIds.includes(result.executionId)) {
      parent = await updateParent(context, parent.parentExecutionId, {
        childExecutionIds: [...parent.childExecutionIds, result.executionId],
        state: result.status === "rejected" ? "stopped" : "waiting_approval",
      });
    }
    if (result.status === "rejected") {
      const iteration = await buildParentIteration(
        context,
        current,
        result,
        parent.parentExecutionId,
      );
      parent = await updateParent(context, parent.parentExecutionId, {
        iterations: [...parent.iterations, iteration],
        remainingFindings: parent.remainingFindings,
        sideEffectCounts: addIterationCounts(parent, iteration),
        sideEffects: appendCompletedSideEffects(parent, current, iteration),
      });
      parent = await finalizeParent(context, parent, "stopped", "rejected");
      printCorrectionSummary(terminal, parent);
      return 1;
    }
    if (isRootCancellationRequested(context)) {
      parent = await finalizeParent(context, parent, "stopped", "aborted");
      printCorrectionSummary(terminal, parent);
      return 1;
    }
    const payload = result.reportPayload;
    if (payload === undefined) {
      parent = await finalizeParent(
        context,
        parent,
        "stopped",
        "visual_validation_inconclusive",
      );
      printCorrectionSummary(terminal, parent);
      return 1;
    }
    const iteration = await buildParentIteration(
      context,
      current,
      result,
      parent.parentExecutionId,
    );
    const remaining = stringArrayField(payload, "unresolvedFindings");
    const introduced = stringArrayField(payload, "introducedFindings");
    const resolved = stringArrayField(payload, "resolvedFindings");
    const freshVisual = result.visualReportPayload;
    const inspected = inspectRegisteredProject(current.project);
    const nextParent = await updateParent(context, parent.parentExecutionId, {
      state:
        payload.continuationAllowed === true
          ? "waiting_next_iteration"
          : "evaluating_iteration",
      currentIterationNumber: current.iterationNumber,
      currentProjectFingerprint: inspected.project.contextFingerprint,
      currentImplementationHash: hashObject(inspected),
      ...(freshVisual !== undefined
        ? {
            currentVisualReport: parentArtifact(
              "revalidated-visual-validation-report",
              hashObject(freshVisual),
            ),
          }
        : {}),
      iterations: parent.iterations.some(
        (candidate) => candidate.iterationNumber === iteration.iterationNumber,
      )
        ? parent.iterations
        : [...parent.iterations, iteration],
      sideEffectCounts: parent.iterations.some(
        (candidate) => candidate.iterationNumber === iteration.iterationNumber,
      )
        ? parent.sideEffectCounts
        : addIterationCounts(parent, iteration),
      sideEffects: appendCompletedSideEffects(parent, current, iteration),
      resolvedFindings: [...new Set([...parent.resolvedFindings, ...resolved])],
      remainingFindings: remaining,
      introducedFindings: [
        ...new Set([...parent.introducedFindings, ...introduced]),
      ],
      cumulativeFileChanges: [
        ...new Set([
          ...parent.cumulativeFileChanges,
          ...stringArrayField(
            objectField(
              Array.isArray(payload.iterations)
                ? payload.iterations[0]
                : undefined,
              "applicationResult",
            ),
            "changedFiles",
          ),
        ]),
      ],
      rollbackCount:
        parent.rollbackCount +
        (payload.stopReason === "project_validation_failed" ? 1 : 0),
    });
    parent = nextParent;
    const canContinue =
      payload.continuationAllowed === true &&
      current.iterationNumber < current.iterationPolicy.maxIterations;
    if (canContinue) continue;
    const finalStatus =
      payload.finalStatus === "pass" ||
      payload.finalStatus === "pass_with_findings"
        ? payload.finalStatus
        : "fail";
    parent = await finalizeParent(
      context,
      parent,
      finalStatus,
      typeof payload.stopReason === "string" ? payload.stopReason : "aborted",
    );
    printCorrectionSummary(terminal, parent);
    return finalStatus === "pass" || finalStatus === "pass_with_findings"
      ? 0
      : 1;
  }
}

function isRootCancellationRequested(context: CliContext): boolean {
  return context.signal?.aborted === true;
}

function printCorrectionSummary(
  terminal: Terminal,
  parent: FeedbackLoopParentRecordV1,
): void {
  const iteration = parent.iterations.at(-1);
  terminal.print();
  terminal.print(
    parent.finalStatus === "pass" || parent.finalStatus === "pass_with_findings"
      ? "Visual correction beta"
      : "Visual correction stopped",
  );
  if (iteration === undefined) {
    terminal.print("No correction iteration was started.");
    return;
  }
  terminal.print(`Iteration ${iteration.iterationNumber}`);
  terminal.print(
    `  Proposal: ${iteration.status === "rejected" ? "rejected" : iteration.approvalIds.length > 0 ? "approved" : "not completed"}`,
  );
  terminal.print(
    `  Project changes: ${iteration.applicationArtifactIds.length > 0 ? "applied" : "No"}`,
  );
  terminal.print(
    `  Validation: ${iteration.validationArtifactIds.length > 0 ? "completed" : "not completed"}`,
  );
  if (iteration.rollbackArtifactIds.length > 0)
    terminal.print("  Project changes: rolled back");
  terminal.print(`  Visual result: ${visualResultFor(iteration, parent)}`);
  if (parent.stopReason !== undefined)
    terminal.print(`  Stop reason: ${parent.stopReason.replace(/_/g, " ")}`);
  terminal.print("Another correction iteration was not started.");
  terminal.print(`Inspect: designflow artifacts ${iteration.childExecutionId}`);
}

function visualResultFor(
  iteration: FeedbackLoopParentRecordV1["iterations"][number],
  parent: FeedbackLoopParentRecordV1,
): string {
  switch (parent.stopReason) {
    case "passed": return "passed";
    case "regression_detected": return "regressed";
    case "no_improvement": return "unchanged";
    case "project_validation_failed": return "inconclusive";
    case "visual_validation_inconclusive": return "inconclusive";
    case "renderer_unavailable": return "unavailable";
    default:
      return iteration.resolvedFindings.length > 0 ? "improved" : "unchanged";
  }
}
