import type { CliContext } from "../../services/cli-runner";
import {
  detectCurrentProject,
  ensureCurrentProject,
} from "../../services/current-project";

export type ViewStatus =
  | "ready"
  | "active"
  | "pending"
  | "unavailable"
  | "not-configured"
  | "not-detected"
  | "idle";

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
    readonly label: string;
    readonly status: ViewStatus;
  };
  readonly destination: {
    readonly label: string;
    readonly status: ViewStatus;
  };
  readonly approvalMode?: "manual";
  readonly workflow: {
    readonly status: ViewStatus;
    readonly activeStage?: string;
    readonly stages: readonly WorkflowStageView[];
  };
  readonly outputs: readonly OutputView[];
  readonly activity: readonly string[];
  readonly diagnostics: readonly string[];
  readonly finalResult?: {
    readonly status: "success" | "failure";
    readonly summary: string;
  };
}

export interface WorkflowStageView {
  readonly id: string;
  readonly label: string;
  readonly status: "complete" | "active" | "pending";
}

export interface OutputView {
  readonly id: string;
  readonly label: string;
  readonly status: "available" | "pending";
}

export interface SessionViewFacts {
  readonly project?: {
    readonly name: string;
    readonly path?: string;
  };
  readonly figma: "connected" | "unavailable" | "not-configured";
  readonly ai: "connected" | "sign-in-required" | "development-provider" | "not-configured";
  readonly design?: string;
  readonly destination?: string;
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
      : { label: facts.design, status: "ready" },
    destination: facts.destination === undefined
      ? { label: "Not selected", status: "idle" }
      : { label: facts.destination, status: "ready" },
    approvalMode: "manual",
    workflow: {
      status: "idle",
      stages: DESIGNFLOW_WORKFLOW_STAGES,
    },
    outputs: [],
    activity: ["Ready to start"],
    diagnostics: [],
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

export async function buildSessionViewFromContext(
  context: CliContext,
): Promise<DesignFlowSessionView> {
  const detected = detectCurrentProject();
  const project = await ensureCurrentProject(context, detected);

  await context.refreshAiSession();
  await context.ensureFigmaConnection();

  return buildSessionView({
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
  });
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
