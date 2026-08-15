import type { ArtifactSummary, ExecutionProgress } from "@designflow/product";
import {
  DESIGN_TO_CODE_PRODUCT_STAGES,
  designToCodeStage,
  designToCodeStageForCapability,
  type DesignToCodeStageId,
  type SessionResult,
} from "@designflow/sdk";
import type {
  ActivityActor,
  ActivityView,
  CheckView,
  DesignFlowSessionView,
  OutputView,
  WorkflowStageView,
} from "./model";
import { buildProductFailure } from "../../services/failure-presentation";
import type { VisualResultView } from "../../services/visual-result";
import type { TuiReviewRequest } from "./navigation";

export type ExecutionPresentationStatus = "running" | "completed" | "failed" | "cancelled" | "waiting";

export interface ExecutionPresentationUpdate {
  readonly status?: ExecutionPresentationStatus;
  readonly diagnostics?: readonly string[];
  readonly attempt?: { readonly current: number; readonly maximum: number };
}

export interface TuiExecutionBridge {
  readonly update: (session: DesignFlowSessionView) => void;
  readonly progress: (progress: ExecutionProgress) => void;
  readonly result: (result: SessionResult) => void;
  readonly report: (report: unknown) => void;
  readonly cancelled: () => void;
  readonly ask: (question: string, options?: readonly string[]) => Promise<string>;
  readonly review: (request: TuiReviewRequest) => Promise<"approve" | "reject">;
  readonly visual: (result: VisualResultView) => void;
  readonly authRequired: (message?: string) => void;
}

// ── Canonical stage derivation (V2-9) ──────────────────────────
//
// The stage vocabulary is owned by the SDK's product-stage contract
// (`DESIGN_TO_CODE_PRODUCT_STAGES`) — this file no longer keeps its own list.
// Both the current V2 flagship capabilities and the historical legacy
// capabilities resolve into that one vocabulary, so old runs still render.

type StageId = DesignToCodeStageId;

/**
 * The stage rows a run shows: canonical order, with the conditional stages
 * (`refining`) included only when observed and `done` rendered as the result
 * rather than a row.
 */
function stageRows(observedStages: ReadonlySet<StageId>): readonly DesignToCodeStageId[] {
  return DESIGN_TO_CODE_PRODUCT_STAGES.filter(
    (stage) => stage.id !== "done" && (stage.normalVisible || observedStages.has(stage.id)),
  ).map((stage) => stage.id);
}

/**
 * Live activity attribution. The V2 Mapper and Builder nodes run their agent
 * when one is configured; every other node is deterministic host work and is
 * deliberately NOT presented as AI (§62). Legacy actor ids remain so
 * historical runs keep their labels.
 */
const AI_ACTORS: Readonly<Record<string, ActivityActor>> = {
  "map-v2-project": "project-mapper",
  "build-v2-implementation": "ui-builder",
  "invoke-figma-specification-agent": "specification-ai",
  "invoke-implementation-agent": "implementation-ai",
  "invoke-visual-validation-agent": "visual-validation-ai",
  "invoke-visual-validation-agent-stage5": "visual-validation-ai",
  "invoke-visual-correction-agent": "visual-correction-ai",
};

const AI_DETAILS: Readonly<Record<string, string>> = {
  "compile-v2-blueprint": "Understanding the design",
  "map-v2-project": "Matching the design to this project",
  "build-v2-implementation": "Preparing the implementation",
  "run-visual-convergence": "Checking the rendered implementation",
  "invoke-figma-specification-agent": "Reading design evidence",
  "invoke-implementation-agent": "Preparing proposal",
  "invoke-visual-validation-agent": "Comparing implementation with design",
  "invoke-visual-validation-agent-stage5": "Comparing implementation with design",
  "invoke-visual-correction-agent": "Preparing improvement",
};

export const LIVE_STAGE_ORDER: readonly StageId[] = DESIGN_TO_CODE_PRODUCT_STAGES.filter(
  (stage) => stage.normalVisible,
).map((stage) => stage.id);

export function stageForCapability(capabilityId: string): StageId | undefined {
  return designToCodeStageForCapability(capabilityId);
}

export function actorForCapability(capabilityId: string): ActivityActor {
  return AI_ACTORS[capabilityId] ?? "designflow";
}

export function applyExecutionProgress(
  session: DesignFlowSessionView,
  progress: ExecutionProgress,
): DesignFlowSessionView {
  const observed = new Map<string, { status: "done" | "active" | "pending"; label: string }>();
  for (const step of progress.steps) {
    if (step.capabilityId === undefined || stageForCapability(step.capabilityId) === undefined) continue;
    observed.set(step.capabilityId, { status: step.status, label: step.label });
  }

  const observedStages = new Set(
    [...observed.keys()]
      .map((capabilityId) => stageForCapability(capabilityId))
      .filter((stage): stage is StageId => stage !== undefined),
  );
  const stages: WorkflowStageView[] = stageRows(observedStages).map((id) => {
    const label = designToCodeStage(id).label;
    const steps = [...observed.entries()].filter(([capabilityId]) => stageForCapability(capabilityId) === id);
    if (steps.some(([, step]) => step.status === "active")) return { id, label, status: "active" };
    if (steps.length > 0 && steps.every(([, step]) => step.status === "done")) return { id, label, status: "complete" };
    return { id, label, status: "pending" };
  });

  const activeStep = progress.steps.findLast((step) => step.status === "active" && step.capabilityId !== undefined) as
    | ((typeof progress.steps)[number] & { readonly attempt?: number; readonly maxAttempts?: number })
    | undefined;
  const activeStage = activeStep?.capabilityId === undefined ? undefined : stageForCapability(activeStep.capabilityId);
  const activity: ActivityView[] = [];
  for (const step of progress.steps) {
    if (step.capabilityId === undefined || stageForCapability(step.capabilityId) === undefined) continue;
    const actor = actorForCapability(step.capabilityId);
    const existing = activity.find((item) => item.title === step.label && item.actor === actor);
    const next: ActivityView = {
      actor,
      title: step.label,
      ...(AI_DETAILS[step.capabilityId] !== undefined ? { detail: AI_DETAILS[step.capabilityId] } : {}),
      state: step.status === "active" ? "running" : step.status === "done" ? "completed" : "pending",
    };
    if (existing === undefined) activity.push(next);
    else if (next.state === "running" || next.state === "completed") activity[activity.indexOf(existing)] = next;
  }

  const checks: CheckView[] = progress.steps
    .filter((step) => step.capabilityId !== undefined && (stageForCapability(step.capabilityId) === "applying" || step.capabilityId === "run-project-validation"))
    .map((step) => ({
      id: step.capabilityId!,
      label: step.label,
      status: step.status === "done" ? "passed" : step.status === "active" ? "running" : "pending",
    }));

  // §55: while the run waits for the human, the product stage is Review —
  // never Applying, and never a generic pause. This also holds across
  // resume, because approval state is re-derived from the same progress.
  const waitingForApproval = progress.approval === "waiting";

  return {
    ...session,
    workflow: {
      ...session.workflow,
      status: "active",
      ...(waitingForApproval
        ? { activeStage: "review" as const }
        : activeStage === undefined
          ? {}
          : { activeStage }),
      stages: waitingForApproval
        ? stages.map((stage) => (stage.id === "review" ? { ...stage, status: "active" as const } : stage))
        : stages,
    },
    activity: progress.approval === "waiting"
      ? [{
          actor: "designflow" as const,
          title: session.approval.mode === "designflow" ? "Needs your review" : "Review required",
          detail: session.approval.mode === "designflow"
            ? "DesignFlow could not safely approve this proposal automatically."
            : "Review the validated proposal before it is applied.",
          state: "running" as const,
        }]
      : progress.approval === "automatic"
        ? [...activity, { actor: "designflow" as const, title: "Approved automatically", detail: "DesignFlow approved this validated proposal within the selected scope.", state: "completed" as const }].slice(-12)
        : activity.slice(-12),
    approval: progress.approval === "waiting" && session.approval.mode === "designflow"
      ? { ...session.approval, status: "needs-review" }
      : progress.approval === "automatic"
        ? { ...session.approval, mode: "designflow", status: "approved" }
        : session.approval,
    checks: checks.slice(-8),
    ...(activeStep?.attempt === undefined ? {} : {
      attempt: {
        current: activeStep.attempt,
        maximum: activeStep.maxAttempts ?? activeStep.attempt,
      },
    }),
  };
}

export function applyExecutionUpdate(
  session: DesignFlowSessionView,
  update: ExecutionPresentationUpdate,
): DesignFlowSessionView {
  const next = { ...session };
  if (update.status === "cancelled") {
    return {
      ...next,
      workflow: { ...next.workflow, status: "idle" },
      activity: [{ actor: "designflow", title: "Cancelled", state: "completed" }],
      finalResult: { status: "failure", summary: "Cancelled before the workflow finished." },
    };
  }
  if (update.status === "failed") {
    return {
      ...next,
      workflow: { ...next.workflow, status: "unavailable" },
      activity: [{ actor: "designflow", title: "Needs attention", ...(update.diagnostics?.[0] === undefined ? {} : { detail: update.diagnostics[0] }), state: "failed" }],
      diagnostics: update.diagnostics ?? next.diagnostics,
      finalResult: { status: "failure", summary: update.diagnostics?.[0] ?? "The workflow did not complete." },
      ...(update.attempt === undefined ? {} : { attempt: update.attempt }),
    };
  }
  if (update.status === "completed") {
    const { activeStage: _activeStage, ...workflowWithoutActiveStage } = next.workflow;
    return {
      ...next,
      workflow: {
        ...workflowWithoutActiveStage,
        status: "ready",
        // Only stages that actually ran become ✓. A stage that never started
        // (correction on a run where the user has not chosen Improve) stays
        // pending — completion of the run is not completion of every stage.
        stages: next.workflow.stages.map((stage) =>
          stage.status === "pending" ? stage : { ...stage, status: "complete" as const }),
      },
      activity: [{ actor: "designflow", title: "Ready for review", state: "completed" }],
      finalResult: { status: "success", summary: "Implementation complete. Ready for review." },
      ...(update.attempt === undefined ? {} : { attempt: update.attempt }),
    };
  }
  return {
    ...next,
    activity: update.status === "waiting"
      ? [{ actor: "designflow", title: "More information needed", ...(update.diagnostics?.[0] === undefined ? {} : { detail: update.diagnostics[0] }), state: "running" }]
      : next.activity,
    diagnostics: update.diagnostics ?? next.diagnostics,
    ...(update.attempt === undefined ? {} : { attempt: update.attempt }),
  };
}

export function applySessionResult(
  session: DesignFlowSessionView,
  result: SessionResult,
): DesignFlowSessionView {
  if (result.session.status === "waiting_for_user") {
    return applyExecutionUpdate(session, {
      status: "waiting",
      diagnostics: result.message === undefined ? [] : [result.message],
    });
  }
  if (result.session.status === "declined") {
    return applyExecutionUpdate(session, {
      status: "failed",
      diagnostics: result.message === undefined ? ["DesignFlow declined this request."] : [result.message],
    });
  }
  if (result.session.status === "cancelled") return applyExecutionUpdate(session, { status: "cancelled" });
  if (result.session.status === "failed") {
    return applyExecutionUpdate(session, { status: "failed", diagnostics: result.message === undefined ? [] : [result.message] });
  }
  return session;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

export function applyExecutionReport(
  session: DesignFlowSessionView,
  report: unknown,
): DesignFlowSessionView {
  const root = record(report);
  const overview = record(root?.overview);
  if (overview === undefined) return session;
  const artifacts = Array.isArray(root?.artifacts)
    ? root.artifacts
      .map((artifact) => record(artifact))
      .filter((artifact): artifact is Record<string, unknown> => artifact !== undefined)
      .flatMap((artifact) => {
        const parsed = safeArtifactSummary(artifact);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
  const outputEntries = artifacts
    .map(outputForArtifact)
    .filter((output): output is OutputView => output !== undefined);
  const outputs = mergeOutputs(session.outputs, outputEntries);
  const note = understandingNote(artifacts);
  const state = typeof overview.state === "string" ? overview.state : "";
  if (state === "ready") {
    return applyUnderstandingNote({
      ...applyExecutionUpdate(session, { status: "completed" }),
      outputs,
    }, note);
  }
  if (state !== "failed") return applyUnderstandingNote({ ...session, outputs }, note);

  const failure = record(overview.failure);
  const attemptDiagnostics = Array.isArray(failure?.attemptDiagnostics)
    ? failure.attemptDiagnostics
      .map((item) => record(item))
      .filter((item): item is Record<string, unknown> => item !== undefined)
      .filter((item): item is Record<string, unknown> & { attempt: number; code: string; message: string } => typeof item.attempt === "number" && typeof item.code === "string" && typeof item.message === "string")
      .map((item) => ({ attempt: item.attempt, code: item.code, message: item.message, ...(typeof item.path === "string" ? { path: item.path } : {}) }))
    : [];
  const modelCandidates = Array.isArray(failure?.modelCandidates)
    ? failure.modelCandidates
      .map((item) => record(item))
      .filter((item): item is Record<string, unknown> => item !== undefined)
      .filter((item): item is Record<string, unknown> & { model: string; code: string } =>
        typeof item.model === "string" && typeof item.code === "string")
      .map((item) => ({
        model: item.model,
        code: item.code,
        ...(typeof item.durationMs === "number" ? { durationMs: item.durationMs } : {}),
        ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
      }))
    : [];
  const productFailure = buildProductFailure({
    status: typeof overview.status === "string" ? overview.status : "failed",
    errorCode: typeof failure?.errorCode === "string" ? failure.errorCode : undefined,
    failedCapabilityId: typeof failure?.failedCapabilityId === "string" ? failure.failedCapabilityId : undefined,
    underlyingMessage: typeof failure?.message === "string" ? failure.message : undefined,
    executionId: typeof overview.executionId === "string" ? overview.executionId : undefined,
    retryAfterSeconds: typeof failure?.retryAfterSeconds === "number" ? failure.retryAfterSeconds : undefined,
    hasApplication: artifacts.some((artifact) => artifact.artifactId === "file-application-result"),
    hasSnapshot: artifacts.some((artifact) => artifact.artifactId === "project-snapshot"),
    validationFailed: false,
    rollbackTriggered: false,
    ...(attemptDiagnostics.length > 0 ? { attemptDiagnostics } : {}),
    ...(modelCandidates.length > 0 ? { modelCandidates } : {}),
  });
  return applyUnderstandingNote({
    ...applyExecutionUpdate(session, { status: "failed", diagnostics: [productFailure.title, ...productFailure.lines.filter((line) => line.trim().length > 0).slice(0, 8)] }),
    technicalDetails: productFailure.technicalDetails,
    outputs,
  }, note);
}

/**
 * Attaches the Understanding-stage degradation note, if any.
 *
 * A `needs-attention` Understanding stage is deliberately never demoted back
 * to `complete` by a later report (see `applyExecutionUpdate`'s "completed"
 * handler) or promoted to `failed` by a later-stage failure (as in the
 * V2-10 field defect, where Design Interpreter degraded and Project Mapper
 * then failed the whole run): semantic enrichment being unavailable is its
 * own bounded, non-fatal fact about one stage, independent of what happens
 * afterward.
 */
function applyUnderstandingNote(session: DesignFlowSessionView, note: string | undefined): DesignFlowSessionView {
  if (note === undefined) return session;
  return {
    ...session,
    workflow: {
      ...session.workflow,
      stages: session.workflow.stages.map((stage) =>
        stage.id === "understanding" && stage.status !== "failed"
          ? { ...stage, status: "needs-attention" as const, note }
          : stage),
    },
  };
}

const OUTPUT_DEFINITIONS: Readonly<Record<string, {
  readonly label: string;
  readonly kind: OutputView["kind"];
  readonly stage: string;
  readonly viewerType: OutputView["viewerType"];
  readonly priority: number;
}>> = {
  // ── Current V2 flagship artifacts, grouped by canonical stage labels ──
  "ui-blueprint": { label: "Design blueprint", kind: "project-analysis", stage: designToCodeStage("understanding").label, viewerType: "unknown", priority: 2 },
  "implementation-map": { label: "Implementation plan", kind: "component-mapping", stage: designToCodeStage("planning").label, viewerType: "unknown", priority: 5 },
  "visual-convergence": { label: "Visual refinement", kind: "visual-validation", stage: designToCodeStage("checking").label, viewerType: "unknown", priority: 4 },
  "v2-final-review": { label: "Review summary", kind: "proposal", stage: designToCodeStage("review").label, viewerType: "unknown", priority: 3 },
  "v2-finalization-result": { label: "Result", kind: "validation", stage: designToCodeStage("applying").label, viewerType: "unknown", priority: 4 },
  "proposed-file-changes": { label: "Proposal", kind: "proposal", stage: designToCodeStage("building").label, viewerType: "proposal", priority: 5 },
  "implementation-validation": { label: "Validation", kind: "validation", stage: designToCodeStage("applying").label, viewerType: "validation", priority: 5 },
  // ── Historical (legacy architecture) artifacts, translated into the same
  //    canonical vocabulary — compatibility only ──
  "design-specification": { label: "Specification", kind: "specification", stage: designToCodeStage("understanding").label, viewerType: "specification", priority: 5 },
  "stage-3-summary": { label: "Specification", kind: "specification", stage: designToCodeStage("understanding").label, viewerType: "specification", priority: 1 },
  "stage-2-summary": { label: "Project analysis", kind: "project-analysis", stage: designToCodeStage("understanding").label, viewerType: "project-analysis", priority: 1 },
  "project-implementation-context": { label: "Project analysis", kind: "project-analysis", stage: designToCodeStage("understanding").label, viewerType: "project-analysis", priority: 5 },
  "design-system-mapping": { label: "Design system", kind: "component-mapping", stage: designToCodeStage("planning").label, viewerType: "component-mapping", priority: 5 },
  "implementation-plan": { label: "Proposal", kind: "proposal", stage: designToCodeStage("building").label, viewerType: "proposal", priority: 2 },
  "stage-4-summary": { label: "Proposal", kind: "proposal", stage: designToCodeStage("building").label, viewerType: "proposal", priority: 1 },
  "visual-validation-report": { label: "Visual validation", kind: "visual-validation", stage: designToCodeStage("checking").label, viewerType: "visual-validation", priority: 5 },
  "stage-5-summary": { label: "Visual validation", kind: "visual-validation", stage: designToCodeStage("checking").label, viewerType: "visual-validation", priority: 1 },
  "correction-plan": { label: "Correction proposal", kind: "correction", stage: designToCodeStage("refining").label, viewerType: "correction", priority: 3 },
  "proposed-correction-changes": { label: "Correction proposal", kind: "correction", stage: designToCodeStage("refining").label, viewerType: "correction", priority: 5 },
  "feedback-loop-report": { label: "Correction proposal", kind: "correction", stage: designToCodeStage("refining").label, viewerType: "correction", priority: 4 },
  "stage-6-summary": { label: "Correction proposal", kind: "correction", stage: designToCodeStage("refining").label, viewerType: "correction", priority: 1 },
};

function safeArtifactSummary(value: Record<string, unknown>): ArtifactSummary | undefined {
  if (typeof value.artifactId !== "string" || typeof value.name !== "string" || typeof value.type !== "string") return undefined;
  if (value.status !== "created" && value.status !== "reused" && value.status !== "removed" && value.status !== "unchanged") return undefined;
  return {
    artifactId: value.artifactId,
    name: value.name,
    type: value.type,
    status: value.status,
    ...(typeof value.version === "number" ? { version: value.version } : {}),
    ...(typeof value.createdBy === "string" ? { createdBy: value.createdBy } : {}),
    dependencies: Array.isArray(value.dependencies) ? value.dependencies.filter((item): item is string => typeof item === "string") : [],
    ...(value.semanticEnrichment === "enriched" || value.semanticEnrichment === "unavailable" || value.semanticEnrichment === "not_requested"
      ? { semanticEnrichment: value.semanticEnrichment }
      : {}),
  };
}

/**
 * A short, non-fatal note for the Understanding stage row.
 *
 * Reconstructed the same way whether this is a live report or a resumed
 * session's snapshot, because both paths call `applyExecutionReport` with
 * the same durable artifact summaries (§6/§17 of the V2-10 follow-up) — the
 * Blueprint artifact's `semanticEnrichment` fact never depends on the
 * now-discarded model-call error that produced it.
 */
function understandingNote(artifacts: readonly ArtifactSummary[]): string | undefined {
  const blueprint = artifacts.find((artifact) => artifact.type === "design.ui-blueprint");
  return blueprint?.semanticEnrichment === "unavailable" ? "AI semantic enrichment unavailable" : undefined;
}

export function outputForArtifact(artifact: ArtifactSummary): OutputView | undefined {
  if (artifact.status === "removed" || artifact.name === artifact.artifactId) return undefined;
  const definition = OUTPUT_DEFINITIONS[artifact.artifactId];
  if (definition !== undefined) {
    return {
      id: artifact.artifactId,
      label: definition.label,
      kind: definition.kind,
      stage: definition.stage,
      viewerType: definition.viewerType,
      status: "available",
      artifactRef: {
        artifactId: artifact.artifactId,
        type: artifact.type,
        ...(artifact.version === undefined ? {} : { version: artifact.version }),
      },
      artifactSummary: artifact,
    };
  }
  return {
    id: artifact.artifactId,
    label: stripControlCharacters(artifact.name).slice(0, 80),
    kind: "unknown",
    stage: "Output",
    viewerType: "unknown",
    status: "available",
    artifactRef: {
      artifactId: artifact.artifactId,
      type: artifact.type,
      ...(artifact.version === undefined ? {} : { version: artifact.version }),
    },
    artifactSummary: artifact,
  };
}

function mergeOutputs(existing: readonly OutputView[], incoming: readonly OutputView[]): readonly OutputView[] {
  const all = new Map<string, OutputView>();
  for (const output of [...existing, ...incoming]) {
    const key = output.viewerType === "unknown" ? output.id : output.viewerType;
    const current = all.get(key);
    if (current === undefined || preferenceOf(output) >= preferenceOf(current)) all.set(key, output);
  }
  return [...all.values()];
}

function preferenceOf(output: OutputView): number {
  const artifactId = output.artifactRef?.artifactId;
  return artifactId === undefined ? 0 : OUTPUT_DEFINITIONS[artifactId]?.priority ?? 0;
}

function stripControlCharacters(value: string): string {
  return Array.from(value).filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  }).join("");
}
