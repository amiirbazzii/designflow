import type { ExecutionProgress } from "@designflow/product";
import type { SessionResult } from "@designflow/sdk";
import type {
  ActivityActor,
  ActivityView,
  CheckView,
  DesignFlowSessionView,
  WorkflowStageView,
} from "./model";
import { buildProductFailure } from "../../services/failure-presentation";

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
    activity: activity.slice(-12),
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
  const artifacts = Array.isArray(root?.artifacts) ? root.artifacts : [];
  const outputEntries = artifacts
    .map((artifact) => outputForArtifact(String(record(artifact)?.artifactId ?? "")))
    .filter((output): output is { readonly id: string; readonly label: string; readonly status: "available" } => output !== undefined);
  const outputs = [...new Map([...session.outputs, ...outputEntries].map((output) => [output.id, output])).values()];
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
    hasApplication: artifacts.some((artifact) => record(artifact)?.artifactId === "file-application-result"),
    hasSnapshot: artifacts.some((artifact) => record(artifact)?.artifactId === "project-snapshot"),
    validationFailed: false,
    rollbackTriggered: false,
    ...(attemptDiagnostics.length > 0 ? { attemptDiagnostics } : {}),
  });
  return {
    ...applyExecutionUpdate(session, { status: "failed", diagnostics: [productFailure.title, ...productFailure.lines.filter((line) => line.trim().length > 0).slice(0, 8)] }),
    outputs,
  };
}

export function outputForArtifact(artifactId: string): { readonly id: string; readonly label: string; readonly status: "available" } | undefined {
  const labels: Readonly<Record<string, string>> = {
    "design-specification": "Specification",
    "stage-3-summary": "Specification",
    "stage-2-summary": "Design understanding",
    "implementation-validation": "Validation report",
    "proposed-file-changes": "Proposal",
    "stage-4-summary": "Implementation proposal",
    "stage-5-summary": "Visual validation",
    "stage-6-summary": "Correction proposal",
  };
  const label = labels[artifactId];
  return label === undefined ? undefined : { id: artifactId, label, status: "available" };
}
