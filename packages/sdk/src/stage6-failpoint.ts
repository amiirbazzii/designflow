import { z } from "zod";

/** Exit code used only by installed acceptance failpoints. */
export const STAGE6_FAILPOINT_EXIT_CODE = 75;

export const stage6FailpointSchema = z.enum([
  "after_approval_consumed",
  "after_snapshot_created",
  "after_correction_applied",
  "after_first_correction_write",
  "after_project_validation",
  "after_preview_ready",
  "after_desktop_capture",
  "after_tablet_capture",
  "after_mobile_capture",
  "after_visual_report_persisted",
  "after_iteration_evaluated",
  "after_parent_stop_persisted",
]);
export type Stage6Failpoint = z.infer<typeof stage6FailpointSchema>;

/**
 * Test-only process termination. Ordinary production processes have no
 * NODE_ENV=test/development and therefore cannot enable this boundary.
 */
export function terminateAtStage6Failpoint(
  failpoint: Stage6Failpoint,
): void {
  const environment = process.env["NODE_ENV"];
  if (environment !== "test" && environment !== "development") return;
  if (process.env["DESIGNFLOW_STAGE6_FAILPOINT"] !== failpoint) return;

  process.stderr.write(`DESIGNFLOW_STAGE6_FAILPOINT:${failpoint}\n`);
  process.exit(STAGE6_FAILPOINT_EXIT_CODE);
}

export function stage6FailpointEnabled(failpoint: Stage6Failpoint): boolean {
  const environment = process.env["NODE_ENV"];
  return (
    (environment === "test" || environment === "development") &&
    process.env["DESIGNFLOW_STAGE6_FAILPOINT"] === failpoint
  );
}

export function stage6FailpointForNode(
  workflowId: string,
  nodeId: string,
): Stage6Failpoint | undefined {
  if (workflowId !== "design-to-code-feedback-loop") return undefined;
  const mapping: Partial<Record<string, Stage6Failpoint>> = {
    "consume-correction-approval": "after_approval_consumed",
    "create-correction-snapshot": "after_snapshot_created",
    "apply-approved-correction": "after_correction_applied",
    "run-correction-project-validation": "after_project_validation",
    "start-preview-server": "after_preview_ready",
    "rerun-visual-validation": "after_visual_report_persisted",
    "evaluate-feedback-loop": "after_iteration_evaluated",
  };
  return mapping[nodeId];
}
