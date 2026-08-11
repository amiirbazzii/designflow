import type { ArtifactSummary, ExecutionProgress } from "@designflow/product";
import type { SessionResult } from "@designflow/sdk";
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
}

const STAGE_ORDER = [
  "understanding",
  "specification",
  "project-analysis",
  "implementation",
  "validation",
  "visual-check",
  "correction",
] as const;

type StageId = (typeof STAGE_ORDER)[number];

const STAGE_LABELS: Readonly<Record<StageId, string>> = {
  understanding: "Understanding",
  specification: "Specification",
  "project-analysis": "Project analysis",
  implementation: "Implementation",
  validation: "Validation",
  "visual-check": "Visual check",
  correction: "Correction",
};

const STAGE_CAPABILITIES: Readonly<Record<StageId, readonly string[]>> = {
  understanding: ["parse-figma-source", "retrieve-figma-source-snapshot", "prepare-figma-source-fixture"],
  specification: ["invoke-figma-specification-agent", "store-stage-3-summary"],
  "project-analysis": ["inspect-registered-project", "map-design-system", "store-implementation-plan"],
  implementation: ["invoke-implementation-agent", "store-proposed-file-changes", "store-generated-implementation"],
  validation: ["run-project-validation", "create-project-snapshot", "apply-approved-file-changes", "store-implementation-validation"],
  "visual-check": [
    "prepare-visual-validation", "start-preview-server", "capture-implementation-screenshots",
    "resolve-reference-evidence", "store-dom-and-computed-style-evidence", "compare-visual-evidence",
    "invoke-visual-validation-agent", "invoke-visual-validation-agent-stage5", "store-visual-validation-report", "store-stage-5-summary",
  ],
  correction: [
    "select-actionable-findings", "prepare-correction-context", "store-correction-plan",
    "store-proposed-correction-changes", "request-correction-approval", "consume-correction-approval",
    "create-correction-snapshot", "apply-approved-correction", "run-correction-project-validation",
    "rerun-stage5-visual-validation", "evaluate-feedback-loop", "store-feedback-loop-input",
    "store-feedback-loop-iteration", "normalize-feedback-loop-revalidation-gate", "store-stage-6-summary",
  ],
};

const AI_ACTORS: Readonly<Record<string, ActivityActor>> = {
  "invoke-figma-specification-agent": "specification-ai",
  "invoke-implementation-agent": "implementation-ai",
  "invoke-visual-validation-agent": "visual-validation-ai",
  "invoke-visual-validation-agent-stage5": "visual-validation-ai",
  "invoke-visual-correction-agent": "visual-correction-ai",
};

const AI_DETAILS: Readonly<Record<string, string>> = {
  "invoke-figma-specification-agent": "Reading design evidence",
  "invoke-implementation-agent": "Preparing proposal",
  "invoke-visual-validation-agent": "Comparing implementation with design",
  "invoke-visual-validation-agent-stage5": "Comparing implementation with design",
  "invoke-visual-correction-agent": "Preparing improvement",
};

export const LIVE_STAGE_ORDER: readonly StageId[] = STAGE_ORDER;

export function stageForCapability(capabilityId: string): StageId | undefined {
  return STAGE_ORDER.find((stage) => STAGE_CAPABILITIES[stage].includes(capabilityId));
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

  const stages: WorkflowStageView[] = STAGE_ORDER.map((id) => {
    const steps = [...observed.entries()].filter(([capabilityId]) => stageForCapability(capabilityId) === id);
    if (steps.some(([, step]) => step.status === "active")) return { id, label: STAGE_LABELS[id], status: "active" };
    if (steps.length > 0 && steps.every(([, step]) => step.status === "done")) return { id, label: STAGE_LABELS[id], status: "complete" };
    return { id, label: STAGE_LABELS[id], status: "pending" };
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
    .filter((step) => step.capabilityId !== undefined && (stageForCapability(step.capabilityId) === "validation" || step.capabilityId === "run-project-validation"))
    .map((step) => ({
      id: step.capabilityId!,
      label: step.label,
      status: step.status === "done" ? "passed" : step.status === "active" ? "running" : "pending",
    }));

  return {
    ...session,
    workflow: {
      ...session.workflow,
      status: "active",
      ...(activeStage === undefined ? {} : { activeStage }),
      stages,
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
        stages: next.workflow.stages.map((stage) => ({ ...stage, status: "complete" })),
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
  const state = typeof overview.state === "string" ? overview.state : "";
  if (state === "ready") {
    return {
      ...applyExecutionUpdate(session, { status: "completed" }),
      outputs,
    };
  }
  if (state !== "failed") return { ...session, outputs };

  const failure = record(overview.failure);
  const attemptDiagnostics = Array.isArray(failure?.attemptDiagnostics)
    ? failure.attemptDiagnostics
      .map((item) => record(item))
      .filter((item): item is Record<string, unknown> => item !== undefined)
      .filter((item): item is Record<string, unknown> & { attempt: number; code: string; message: string } => typeof item.attempt === "number" && typeof item.code === "string" && typeof item.message === "string")
      .map((item) => ({ attempt: item.attempt, code: item.code, message: item.message, ...(typeof item.path === "string" ? { path: item.path } : {}) }))
    : [];
  const productFailure = buildProductFailure({
    status: typeof overview.status === "string" ? overview.status : "failed",
    errorCode: typeof failure?.errorCode === "string" ? failure.errorCode : undefined,
    failedCapabilityId: typeof failure?.failedCapabilityId === "string" ? failure.failedCapabilityId : undefined,
    hasApplication: artifacts.some((artifact) => artifact.artifactId === "file-application-result"),
    hasSnapshot: artifacts.some((artifact) => artifact.artifactId === "project-snapshot"),
    validationFailed: false,
    rollbackTriggered: false,
    ...(attemptDiagnostics.length > 0 ? { attemptDiagnostics } : {}),
  });
  return {
    ...applyExecutionUpdate(session, { status: "failed", diagnostics: [productFailure.title, ...productFailure.lines.filter((line) => line.trim().length > 0).slice(0, 8)] }),
    outputs,
  };
}

const OUTPUT_DEFINITIONS: Readonly<Record<string, {
  readonly label: string;
  readonly kind: OutputView["kind"];
  readonly stage: string;
  readonly viewerType: OutputView["viewerType"];
  readonly priority: number;
}>> = {
  "design-specification": { label: "Specification", kind: "specification", stage: "Specification", viewerType: "specification", priority: 5 },
  "stage-3-summary": { label: "Specification", kind: "specification", stage: "Specification", viewerType: "specification", priority: 1 },
  "stage-2-summary": { label: "Project analysis", kind: "project-analysis", stage: "Understanding", viewerType: "project-analysis", priority: 1 },
  "project-implementation-context": { label: "Project analysis", kind: "project-analysis", stage: "Project analysis", viewerType: "project-analysis", priority: 5 },
  "design-system-mapping": { label: "Design system", kind: "component-mapping", stage: "Project analysis", viewerType: "component-mapping", priority: 5 },
  "implementation-plan": { label: "Proposal", kind: "proposal", stage: "Implementation", viewerType: "proposal", priority: 2 },
  "proposed-file-changes": { label: "Proposal", kind: "proposal", stage: "Implementation", viewerType: "proposal", priority: 5 },
  "stage-4-summary": { label: "Proposal", kind: "proposal", stage: "Implementation", viewerType: "proposal", priority: 1 },
  "implementation-validation": { label: "Validation", kind: "validation", stage: "Validation", viewerType: "validation", priority: 5 },
  "visual-validation-report": { label: "Visual validation", kind: "visual-validation", stage: "Visual check", viewerType: "visual-validation", priority: 5 },
  "stage-5-summary": { label: "Visual validation", kind: "visual-validation", stage: "Visual check", viewerType: "visual-validation", priority: 1 },
  "correction-plan": { label: "Correction proposal", kind: "correction", stage: "Correction", viewerType: "correction", priority: 3 },
  "proposed-correction-changes": { label: "Correction proposal", kind: "correction", stage: "Correction", viewerType: "correction", priority: 5 },
  "feedback-loop-report": { label: "Correction proposal", kind: "correction", stage: "Correction", viewerType: "correction", priority: 4 },
  "stage-6-summary": { label: "Correction proposal", kind: "correction", stage: "Correction", viewerType: "correction", priority: 1 },
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
  };
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
