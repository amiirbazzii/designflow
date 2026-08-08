import { createHash } from "node:crypto";
import { z } from "zod";
import {
  FEEDBACK_LOOP_HARD_LIMITS,
  feedbackLoopInputV1Schema,
  feedbackLoopParentStateSchema,
  implementationValidationReportSchema,
  projectImplementationContextV1Schema,
  visualValidationReportV1Schema,
  type FeedbackLoopParentRecordV1,
  type FeedbackLoopInputV1,
  type RegistryArtifactStore,
  type VisualValidationReportV1,
} from "@designflow/sdk";
import type {
  ArtifactInspectionService,
  ArtifactSummary,
  ExecutionReport,
} from "@designflow/product";
import {
  FEEDBACK_LOOP_WORKFLOW_ID,
  feedbackLoopWorkflowInputSchema,
  implementationWorkflowInputSchema,
  selectActionableFindings,
  type FeedbackLoopWorkflowInput,
  type ImplementationWorkflowInput,
} from "../services/cli-runner";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Same file identity Stage 4's application service records as `postWriteHash`. */
function appliedFileHash(path: string): string | undefined {
  try {
    return createHash("sha256").update(readFileSync(path).toString("base64")).digest("hex");
  } catch {
    return undefined;
  }
}

export const VISUAL_CORRECTION_BETA_LABEL = "Visual correction (Beta)";
export const CANONICAL_CORRECTION_MAX_ITERATIONS = 1 as const;

export const visualCorrectionEligibilityStatusSchema = z.enum([
  "eligible",
  "not_needed",
  "unavailable",
  "inconclusive",
  "blocked",
  "already_active",
  "completed",
  "iteration_limit_reached",
]);
export type VisualCorrectionEligibilityStatus = z.infer<
  typeof visualCorrectionEligibilityStatusSchema
>;

export interface VisualCorrectionEligibility {
  readonly status: VisualCorrectionEligibilityStatus;
  readonly reason: string;
  readonly iterationNumber: number;
  readonly maximumIterations: number;
  readonly actionableFindingCount: number;
}

export interface VisualCorrectionPreparation {
  readonly eligibility: VisualCorrectionEligibility;
  readonly input?: FeedbackLoopWorkflowInput;
}

interface VersionedArtifact<T> {
  readonly ref: FeedbackLoopInputV1["generatedImplementation"];
  readonly payload: T;
}

interface RequiredArtifacts {
  readonly projectContext: VersionedArtifact<ReturnType<typeof projectImplementationContextV1Schema.parse>>;
  readonly generatedImplementation: VersionedArtifact<Record<string, unknown>>;
  readonly designSpecification: VersionedArtifact<unknown>;
  readonly designSystemMapping: VersionedArtifact<unknown>;
  readonly visualReport: VersionedArtifact<VisualValidationReportV1>;
  /** Present when the run applied files: the snapshot's per-file post-write hashes. */
  readonly appliedFiles?: readonly { readonly path: string; readonly postWriteHash?: string }[];
}

export interface EligibilityProjectionInput {
  readonly run: ExecutionReport;
  readonly implementationInput: ImplementationWorkflowInput | undefined;
  readonly artifacts: RequiredArtifacts | undefined;
  readonly validationPassed: boolean;
  readonly validationRolledBack: boolean;
  readonly currentProjectFingerprint: string | undefined;
  readonly currentProjectRootIdentity: string | undefined;
  /**
   * For a run that applied files: whether every applied file still carries
   * its snapshot-recorded post-write hash. The pre-apply project fingerprint
   * can never match after a real apply — the run's own writes changed it —
   * so applied-run staleness is judged against exactly what the run wrote.
   */
  readonly appliedStateFresh: boolean | undefined;
  readonly correctionWorkflowRegistered: boolean;
  readonly pendingApproval: boolean;
  readonly parent: FeedbackLoopParentRecordV1 | null;
  readonly actionableFindingCount: number;
}

function eligibility(
  input: EligibilityProjectionInput,
): VisualCorrectionEligibility {
  const parent = input.parent;
  const currentIteration = parent?.currentIterationNumber ?? 0;
  const maximumIterations =
    parent?.maxIterations ?? CANONICAL_CORRECTION_MAX_ITERATIONS;
  const base = {
    iterationNumber: currentIteration + 1,
    maximumIterations,
    actionableFindingCount: input.actionableFindingCount,
  };

  if (input.implementationInput === undefined)
    return { ...base, status: "not_needed", reason: "This run produced a design specification only." };
  if (input.run.overview.state !== "ready")
    return { ...base, status: "blocked", reason: "The implementation run did not finish with a valid baseline." };
  if (input.pendingApproval)
    return { ...base, status: "blocked", reason: "An approval is still pending for this run." };
  if (parent?.finalReport !== undefined)
    return { ...base, status: "completed", reason: "Visual correction for this run has already finished." };
  if (parent !== null && currentIteration >= maximumIterations)
    return { ...base, status: "iteration_limit_reached", reason: "The correction iteration limit has been reached." };
  if (parent !== null && parent.state !== "created" && parent.childExecutionIds.length > currentIteration)
    return { ...base, status: "already_active", reason: "A correction iteration is already associated with this run." };
  if (!input.validationPassed)
    return { ...base, status: "blocked", reason: "Project validation did not leave a valid implementation baseline." };
  if (input.validationRolledBack)
    return { ...base, status: "blocked", reason: "The implementation was rolled back, so correction is not safe." };
  if (input.artifacts === undefined)
    return { ...base, status: "unavailable", reason: "Required implementation and visual-validation artifacts are unavailable." };
  if (input.currentProjectFingerprint === undefined)
    return { ...base, status: "blocked", reason: "The project could not be fingerprinted safely." };
  if (input.artifacts.appliedFiles !== undefined) {
    // This run applied files, so the pre-apply fingerprint can never match
    // the current state — staleness is judged against the applied files'
    // snapshot-recorded post-write hashes instead.
    if (input.appliedStateFresh !== true)
      return { ...base, status: "blocked", reason: "The project changed after visual validation; rerun the implementation journey." };
  } else if (input.artifacts.projectContext.payload.project.contextFingerprint !== input.currentProjectFingerprint) {
    return { ...base, status: "blocked", reason: "The project changed after visual validation; rerun the implementation journey." };
  }
  if (
    input.currentProjectRootIdentity !== undefined &&
    input.artifacts.projectContext.payload.project.rootIdentity !==
      input.currentProjectRootIdentity
  )
    return { ...base, status: "blocked", reason: "The registered project identity changed; rerun the implementation journey." };
  if (
    input.artifacts.visualReport.payload.projectId !==
      input.implementationInput.project.id ||
    input.artifacts.visualReport.payload.projectRootIdentity !==
      input.artifacts.projectContext.payload.project.rootIdentity
  )
    return { ...base, status: "blocked", reason: "Visual evidence does not match the selected project." };
  if (input.artifacts.visualReport.payload.overallStatus === "unavailable")
    return { ...base, status: "unavailable", reason: "Visual rendering was unavailable, so correction is not safe." };
  if (input.artifacts.visualReport.payload.overallStatus === "inconclusive")
    return { ...base, status: "inconclusive", reason: "Visual validation was inconclusive, so correction is not safe." };
  if (input.actionableFindingCount === 0)
    return { ...base, status: "not_needed", reason: "Visual validation found no actionable differences." };
  if (!input.correctionWorkflowRegistered)
    return { ...base, status: "unavailable", reason: "Visual correction is not available in this installation." };
  return { ...base, status: "eligible", reason: "Verified visual findings can be corrected in one bounded beta iteration." };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function hashObject(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function summaryFor(
  report: ExecutionReport,
  artifactId: string,
): ArtifactSummary | undefined {
  const matches = report.artifacts.filter(
    (artifact) => artifact.artifactId === artifactId,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

async function readVersioned<T>(
  summary: ArtifactSummary | undefined,
  inspection: ArtifactInspectionService,
  store: RegistryArtifactStore,
  parse: (value: unknown) => T,
): Promise<VersionedArtifact<T> | undefined> {
  if (summary?.version === undefined) return undefined;
  const artifact = await store.getArtifact(summary.artifactId);
  if (artifact === null) return undefined;
  const version = await store.getVersion(summary.artifactId, summary.version);
  if (version === null) return undefined;
  const detail = await inspection.getPayloadAtVersion(summary, summary.version);
  if (detail.payload === undefined) return undefined;
  try {
    return {
      ref: {
        artifactId: summary.artifactId,
        artifactHash: version.hash,
        version: String(version.version),
      },
      payload: parse(detail.payload),
    };
  } catch {
    return undefined;
  }
}

async function requiredArtifacts(
  run: ExecutionReport,
  inspection: ArtifactInspectionService,
  store: RegistryArtifactStore,
): Promise<RequiredArtifacts | undefined> {
  const projectContext = await readVersioned(
    summaryFor(run, "project-implementation-context"),
    inspection,
    store,
    (value) => projectImplementationContextV1Schema.parse(value),
  );
  const generatedImplementation = await readVersioned(
    summaryFor(run, "generated-implementation"),
    inspection,
    store,
    (value) => {
      const parsed = record(value);
      if (parsed === undefined) throw new Error("generated implementation is not an object");
      return parsed;
    },
  );
  const designSpecification = await readVersioned(
    summaryFor(run, "design-specification"),
    inspection,
    store,
    (value) => value,
  );
  const designSystemMapping = await readVersioned(
    summaryFor(run, "design-system-mapping"),
    inspection,
    store,
    (value) => value,
  );
  const visualReport = await readVersioned(
    summaryFor(run, "visual-validation-report"),
    inspection,
    store,
    (value) => visualValidationReportV1Schema.parse(value),
  );
  if (
    projectContext === undefined ||
    generatedImplementation === undefined ||
    designSpecification === undefined ||
    designSystemMapping === undefined ||
    visualReport === undefined
  ) return undefined;
  const application = await readVersioned(
    summaryFor(run, "file-application-result"),
    inspection,
    store,
    (value) => {
      const parsed = record(value);
      if (parsed === undefined) throw new Error("application result is not an object");
      return parsed;
    },
  );
  const appliedFiles = application === undefined ? undefined : snapshotEntries(application.payload);
  return {
    projectContext,
    generatedImplementation,
    designSpecification,
    designSystemMapping,
    visualReport,
    ...(appliedFiles !== undefined ? { appliedFiles } : {}),
  };
}

function snapshotEntries(
  application: Record<string, unknown>,
): readonly { readonly path: string; readonly postWriteHash?: string }[] | undefined {
  const snapshot = record(application["snapshot"]);
  const entries = snapshot?.["entries"];
  if (!Array.isArray(entries)) return undefined;
  return entries.flatMap((entry) => {
    const item = record(entry);
    const path = item?.["path"];
    if (typeof path !== "string" || path.length === 0) return [];
    const postWriteHash = item?.["postWriteHash"];
    return [{ path, ...(typeof postWriteHash === "string" ? { postWriteHash } : {}) }];
  });
}

function changedFiles(payload: Record<string, unknown>): string[] {
  return textArray(payload["changedFiles"]);
}

function affectedFileMap(
  report: VisualValidationReportV1,
  project: ReturnType<typeof projectImplementationContextV1Schema.parse>,
  generated: Record<string, unknown>,
): Record<string, string[]> {
  const changed = changedFiles(generated);
  const components = project.designSystem.components;
  return Object.fromEntries(
    report.findings.map((finding) => {
      const matchingComponent = finding.affectedComponent === undefined
        ? undefined
        : components.find((component) =>
            component.name === finding.affectedComponent ||
            component.sourcePath === finding.affectedComponent,
          );
      const files = matchingComponent === undefined
        ? changed
        : [matchingComponent.sourcePath];
      return [finding.findingId, [...new Set(files)]];
    }),
  );
}

function viewportsFrom(
  originalInput: ImplementationWorkflowInput,
): Array<{ id: string; width: number; height: number }> {
  const inputRecord = record(originalInput);
  const value = inputRecord?.["viewports"];
  if (!Array.isArray(value))
    return [
      { id: "desktop", width: 1440, height: 1024 },
      { id: "tablet", width: 768, height: 1024 },
      { id: "mobile", width: 390, height: 844 },
    ];
  const parsed = value.flatMap((entry) => {
    const item = record(entry);
    if (item === undefined) return [];
    const id = item["id"];
    const width = item["width"];
    const height = item["height"];
    return typeof id === "string" && typeof width === "number" && typeof height === "number"
      ? [{ id, width, height }]
      : [];
  });
  return parsed.length > 0 ? parsed : [{ id: "desktop", width: 1440, height: 1024 }];
}

function validationCommands(
  project: ReturnType<typeof projectImplementationContextV1Schema.parse>,
) {
  return Object.values(project.commands).flatMap((command) =>
    command === undefined
      ? []
      : [{
          name: command.name,
          executable: command.executable,
          args: command.args,
          required: command.required,
        }],
  );
}

export function projectParentId(executionId: string): string {
  return `feedback-loop-parent-${executionId}`;
}

export function readImplementationInput(
  value: unknown,
): ImplementationWorkflowInput | undefined {
  // The session's original input is a superset of the workflow input (it also
  // carries CLI-journey fields such as the free-text request and the journey
  // consent marker). The workflow schema is strict, so parse only its own
  // keys — otherwise an implementation run with correction authorized would
  // silently fail this read and the correction offer would never happen.
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const known = new Set(Object.keys(implementationWorkflowInputSchema.shape));
  const candidate = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([key]) => known.has(key)),
  );
  const parsed = implementationWorkflowInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function assessVisualCorrectionEligibility(
  input: EligibilityProjectionInput,
): VisualCorrectionEligibility {
  return eligibility(input);
}

export async function prepareVisualCorrection(options: {
  readonly executionId: string;
  readonly originalInput: unknown;
  readonly run: ExecutionReport;
  readonly inspection: ArtifactInspectionService;
  readonly artifactStore: RegistryArtifactStore;
  readonly parent: FeedbackLoopParentRecordV1 | null;
  readonly currentProjectFingerprint?: string;
  readonly currentProjectRootIdentity?: string;
  readonly modelProfileId?: string;
  readonly correctionWorkflowRegistered: boolean;
  readonly pendingApproval: boolean;
}): Promise<VisualCorrectionPreparation> {
  const implementationInput = readImplementationInput(options.originalInput);
  const artifacts = implementationInput === undefined
    ? undefined
    : await requiredArtifacts(options.run, options.inspection, options.artifactStore);
  const validationVersioned = await readVersioned(
    summaryFor(options.run, "implementation-validation"),
    options.inspection,
    options.artifactStore,
    (value) => implementationValidationReportSchema.parse(value),
  );
  const validation = validationVersioned?.payload;
  const report = artifacts?.visualReport.payload;
  const candidate = artifacts === undefined || implementationInput === undefined
    ? undefined
    : feedbackLoopWorkflowInputSchema.safeParse({
        schemaVersion: "1",
        workflowId: FEEDBACK_LOOP_WORKFLOW_ID,
        executionId: options.executionId,
        project: {
          ...implementationInput.project,
          canonicalRootIdentity: artifacts.projectContext.payload.project.rootIdentity,
        },
        projectFingerprint: options.currentProjectFingerprint ?? artifacts.projectContext.payload.project.contextFingerprint,
        currentImplementationHash: artifacts.generatedImplementation.ref.artifactHash,
        generatedImplementation: artifacts.generatedImplementation.ref,
        latestVisualValidationReport: artifacts.visualReport.ref,
        designSpecification: artifacts.designSpecification.ref,
        designSystemMapping: artifacts.designSystemMapping.ref,
        actionableFindingIds: report?.findings.map((finding) => finding.findingId) ?? [],
        iterationNumber: 1,
        iterationPolicy: {
          maxIterations: CANONICAL_CORRECTION_MAX_ITERATIONS,
          maxFilesPerIteration: Math.min(5, FEEDBACK_LOOP_HARD_LIMITS.maxFilesPerIteration),
          maxChangedBytesPerIteration: 200_000,
          maxDependenciesPerIteration: 0,
          maxFindingsPerIteration: Math.min(5, FEEDBACK_LOOP_HARD_LIMITS.maxFindingsPerIteration),
          modelInterpretedAllowed: false,
          modelConfidenceThreshold: 0.9,
          requireApprovalEveryIteration: true,
          continueAfterImprovement: false,
        },
        validationConfiguration: {
          commands: validationCommands(artifacts.projectContext.payload),
          timeoutMs: 60_000,
          outputLimitBytes: 100_000,
        },
        viewportConfiguration: {
          viewports: viewportsFrom(implementationInput),
          referenceEvidenceIds: report?.referenceEvidence.map((evidence) => evidence.evidenceId) ?? [],
          rendererVersion: "designflow-visual-validation-v1",
          comparisonAlgorithmVersion: "png-rgba-pixel-diff-v1",
        },
        agentVersion: "0.1.0",
        modelProfileId: options.modelProfileId ?? "visual-correction-default",
        timeouts: { agentMs: 120_000, approvalMs: 7 * 24 * 60 * 60_000 },
        limits: { maxContextBytes: 1_000_000, maxPatchBytes: 1_000_000 },
        stateDirectory: implementationInput.stateDirectory,
        parentChangedFiles: changedFiles(artifacts.generatedImplementation.payload),
        affectedFileMap: report === undefined
          ? {}
          : affectedFileMap(report, artifacts.projectContext.payload, artifacts.generatedImplementation.payload),
        initialVisualValidationReport: report,
      });
  const parsedCandidate = candidate?.success ? candidate.data : undefined;
  const selected = parsedCandidate === undefined || report === undefined
    ? []
    : selectActionableFindings(report, parsedCandidate).selectedFindingIds;
  const finalInput = parsedCandidate === undefined || report === undefined
    ? undefined
    : feedbackLoopWorkflowInputSchema.safeParse({
        ...parsedCandidate,
        actionableFindingIds: selected,
      });
  const appliedStateFresh = artifacts?.appliedFiles === undefined || implementationInput === undefined
    ? undefined
    : artifacts.appliedFiles.every((entry) =>
        entry.postWriteHash === undefined ||
        appliedFileHash(join(implementationInput.project.rootPath, entry.path)) === entry.postWriteHash,
      );
  const eligibilityValue = eligibility({
    run: options.run,
    implementationInput,
    artifacts,
    validationPassed: validation?.passed === true,
    validationRolledBack: validation?.rollbackTriggered === true,
    currentProjectFingerprint: options.currentProjectFingerprint,
    currentProjectRootIdentity: options.currentProjectRootIdentity,
    appliedStateFresh,
    correctionWorkflowRegistered: options.correctionWorkflowRegistered,
    pendingApproval: options.pendingApproval,
    parent: options.parent,
    actionableFindingCount: selected.length,
  });
  return {
    eligibility: eligibilityValue,
    ...(eligibilityValue.status === "eligible" && finalInput?.success
      ? { input: finalInput.data }
      : {}),
  };
}

export function correctionWorkflowStateIsActive(
  value: string,
): boolean {
  const parsed = feedbackLoopParentStateSchema.safeParse(value);
  return parsed.success && [
    "preparing_iteration",
    "waiting_approval",
    "applying_correction",
    "validating_project",
    "revalidating_visuals",
    "evaluating_iteration",
    "waiting_next_iteration",
  ].includes(parsed.data);
}

export function isVisualCorrectionInput(value: unknown): value is FeedbackLoopInputV1 {
  return feedbackLoopInputV1Schema.safeParse(value).success;
}

export function hashVisualCorrectionObject(value: unknown): string {
  return hashObject(value);
}
