import type { ApprovalMode, ProjectIdentity } from "@designflow/sdk";
import type { ArtifactSummary } from "@designflow/product";
import type { CliContext } from "../../services/cli-runner";
import {
  detectCurrentProject,
  ensureCurrentProject,
} from "../../services/current-project";
import type { DestinationCandidate, DestinationKind } from "../../services/destinations";
import type { InteractiveDesign, InteractiveDesignKind } from "../../services/figma-selection";

export type ViewStatus =
  | "ready"
  | "active"
  | "pending"
  | "unavailable"
  | "not-configured"
  | "not-detected"
  | "idle";

export type { ApprovalMode } from "@designflow/sdk";

export type ActivityActor =
  | "designflow"
  | "coordinator"
  | "specification-ai"
  | "implementation-ai"
  | "visual-validation-ai"
  | "visual-correction-ai";

export type ActivityState = "pending" | "running" | "completed" | "failed";

export interface ActivityView {
  readonly actor: ActivityActor;
  readonly title: string;
  readonly detail?: string;
  readonly state: ActivityState;
}

export interface CheckView {
  readonly id: string;
  readonly label: string;
  readonly status: "pending" | "running" | "passed" | "failed";
}

export interface DesignFlowSessionView {
  readonly project: {
    readonly name: string;
    readonly path?: string;
    readonly status: ViewStatus;
  };
  readonly figma: {
    readonly status: ViewStatus;
    readonly label: string;
  };
  readonly ai: {
    readonly status: ViewStatus;
    readonly label: string;
  };
  readonly design: {
    readonly kind?: InteractiveDesignKind;
    readonly label: string;
    readonly status: ViewStatus;
  };
  readonly destination: {
    readonly value?: string;
    readonly kind?: DestinationKind;
    readonly label: string;
    readonly status: ViewStatus;
  };
  readonly approval: {
    readonly mode: ApprovalMode;
    readonly status: "selected" | "approved" | "needs-review";
    readonly scopeSummary: string;
  };
  readonly workflow: {
    readonly status: ViewStatus;
    readonly activeStage?: string;
    readonly stages: readonly WorkflowStageView[];
  };
  readonly outputs: readonly OutputView[];
  readonly activity: readonly ActivityView[];
  readonly attempt?: {
    readonly current: number;
    readonly maximum: number;
  };
  readonly checks: readonly CheckView[];
  readonly diagnostics: readonly string[];
  readonly finalResult?: {
    readonly status: "success" | "failure";
    readonly summary: string;
  };
}

export interface WorkflowStageView {
  readonly id: string;
  readonly label: string;
  readonly status: "complete" | "active" | "pending" | "needs-attention" | "failed" | "skipped";
}

export interface OutputView {
  readonly id: string;
  readonly label: string;
  readonly kind: OutputKind;
  readonly stage: string;
  readonly viewerType: OutputViewerType;
  readonly status: "available" | "pending" | "unavailable";
  readonly artifactRef?: {
    readonly artifactId: string;
    readonly type: string;
    readonly version?: number;
  };
  readonly artifactSummary?: ArtifactSummary;
}

export type OutputKind =
  | "specification"
  | "project-analysis"
  | "component-mapping"
  | "proposal"
  | "validation"
  | "visual-validation"
  | "correction"
  | "unknown";

export type OutputViewerType = OutputKind;

export interface SessionViewFacts {
  readonly project?: {
    readonly name: string;
    readonly path?: string;
  };
  readonly figma: "connected" | "unavailable" | "not-configured";
  readonly ai: "connected" | "sign-in-required" | "development-provider" | "not-configured";
  readonly design?: string | Pick<InteractiveDesign, "kind" | "label">;
  readonly destination?: string | Pick<DestinationCandidate, "label" | "kind" | "path">;
}

export interface SessionViewRuntime {
  readonly project: ProjectIdentity | null;
  readonly session: DesignFlowSessionView;
}

export const DESIGNFLOW_WORKFLOW_STAGES: readonly WorkflowStageView[] = [
  { id: "understanding", label: "Understanding", status: "pending" },
  { id: "specification", label: "Specification", status: "pending" },
  { id: "project-analysis", label: "Project analysis", status: "pending" },
  { id: "implementation", label: "Implementation", status: "pending" },
  { id: "validation", label: "Validation", status: "pending" },
  { id: "visual-check", label: "Visual check", status: "pending" },
  { id: "correction", label: "Correction", status: "pending" },
];

export function buildSessionView(facts: SessionViewFacts): DesignFlowSessionView {
  const project = facts.project;

  return {
    project: project === undefined
      ? { name: "No project detected", status: "not-detected" }
      : { ...project, status: "ready" },
    figma: readinessLine(facts.figma, {
      connected: "Connected",
      unavailable: "Unavailable",
      "not-configured": "Not configured",
    }),
    ai: readinessLine(facts.ai, {
      connected: "Connected",
      "sign-in-required": "Sign-in required",
      "development-provider": "Development provider",
      "not-configured": "Not configured",
    }),
    design: facts.design === undefined
      ? { label: "Not selected", status: "idle" }
      : typeof facts.design === "string"
        ? { label: facts.design, status: "ready" }
        : { kind: facts.design.kind, label: facts.design.label, status: "ready" },
    destination: facts.destination === undefined
      ? { label: "Not selected", status: "idle" }
      : typeof facts.destination === "string"
        ? { label: facts.destination, value: facts.destination, status: "ready" }
        : {
            label: facts.destination.label,
            value: facts.destination.path ?? facts.destination.label,
            kind: facts.destination.kind,
            status: "ready",
          },
    approval: {
      mode: "manual",
      status: "selected",
      scopeSummary: "Validated changes in this run's selected project and destination",
    },
    workflow: {
      status: "idle",
      stages: DESIGNFLOW_WORKFLOW_STAGES,
    },
    outputs: [],
    activity: [{ actor: "designflow", title: "Ready to start", state: "completed" }],
    checks: [],
    diagnostics: [],
  };
}

export function setDesignSelection(
  session: DesignFlowSessionView,
  design: Pick<InteractiveDesign, "kind" | "label">,
): DesignFlowSessionView {
  return {
    ...session,
    design: { ...design, status: "ready" },
  };
}

export function setDestinationSelection(
  session: DesignFlowSessionView,
  destination: Pick<DestinationCandidate, "label" | "kind" | "path">,
): DesignFlowSessionView {
  return {
    ...session,
    destination: {
      label: destination.label,
      value: destination.path ?? destination.label,
      kind: destination.kind,
      status: "ready",
    },
  };
}

export function setApprovalMode(
  session: DesignFlowSessionView,
  mode: ApprovalMode,
): DesignFlowSessionView {
  return {
    ...session,
    approval: {
      ...session.approval,
      mode,
      status: "selected",
    },
  };
}

export function setActiveStage(
  session: DesignFlowSessionView,
  stageId: string,
): DesignFlowSessionView {
  return {
    ...session,
    workflow: {
      ...session.workflow,
      status: "active",
      activeStage: stageId,
      stages: session.workflow.stages.map((stage) => ({
        ...stage,
        status:
          stage.id === stageId
            ? "active"
            : stage.status === "complete"
              ? "complete"
              : "pending",
      })),
    },
  };
}

export function setExecutionStatus(
  session: DesignFlowSessionView,
  status: ViewStatus,
  activity: ActivityView,
): DesignFlowSessionView {
  return {
    ...session,
    workflow: { ...session.workflow, status },
    activity: [activity],
  };
}

export async function buildSessionViewFromContext(
  context: CliContext,
): Promise<DesignFlowSessionView> {
  return (await buildSessionRuntimeFromContext(context)).session;
}

export async function buildSessionRuntimeFromContext(
  context: CliContext,
): Promise<SessionViewRuntime> {
  const detected = detectCurrentProject();
  const project = await ensureCurrentProject(context, detected);

  await context.refreshAiSession();
  await context.ensureFigmaConnection();

  return {
    project,
    session: buildSessionView({
    ...(project === null
      ? {}
      : {
          project: {
            name: project.name,
            ...(project.rootPath !== undefined ? { path: project.rootPath } : {}),
          },
        }),
    figma: context.figmaConnectionStatus(),
    ai: context.aiStatus(),
    }),
  };
}

function readinessLine<T extends string>(
  status: T,
  labels: Record<T, string>,
): { status: ViewStatus; label: string } {
  const normalizedStatus: ViewStatus =
    status === "connected" || status === "development-provider"
      ? "ready"
      : status === "sign-in-required"
        ? "pending"
        : status === "unavailable"
          ? "unavailable"
          : "not-configured";

  return {
    status: normalizedStatus,
    label: labels[status],
  };
}
