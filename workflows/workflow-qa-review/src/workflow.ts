// workflows/workflow-qa-review/src/workflow.ts
import type { ExecutionPolicy, WorkflowDefinition } from "@designflow/sdk";
import { ARTIFACT_IDS } from "./types";

/**
 * QA Review.
 *
 * A linear review pipeline: normalize the supplied implementation, evaluate
 * it for correctness, tag every issue with a severity, check it for common
 * accessibility gaps, then publish a pass/fail verdict.
 *
 * Two things make this workflow incremental rather than merely sequential:
 *
 * - Every node declares what it `produces`, so the planner can decide which
 *   nodes a change actually invalidates instead of rerunning everything.
 * - `produce-qa-report` depends on both the severity assessment and the
 *   accessibility review. That second edge is what lets either input change
 *   and regenerate the report while leaving the other alone.
 */
export const qaReviewWorkflow: WorkflowDefinition = {
  id: "qa-review",
  name: "QA Review",
  description: "Review a supplied implementation for correctness, severity, and accessibility",
  nodes: [
    {
      id: "collect-review-target",
      capabilityId: "collect-review-target",
      // The only node fed from the run's input; everything after it reads
      // artifacts.
      inputMap: { $workflowInput: true },
      produces: [ARTIFACT_IDS.reviewTargetSummary],
      next: ["evaluate-correctness"],
    },
    {
      id: "evaluate-correctness",
      capabilityId: "evaluate-correctness",
      inputMap: {},
      produces: [ARTIFACT_IDS.issueList],
      execution: { dependsOn: ["collect-review-target"] },
      next: ["assess-severity"],
    },
    {
      id: "assess-severity",
      capabilityId: "assess-severity",
      inputMap: {},
      produces: [ARTIFACT_IDS.severityAssessment],
      execution: { dependsOn: ["evaluate-correctness"] },
      next: ["evaluate-accessibility"],
    },
    {
      id: "evaluate-accessibility",
      capabilityId: "evaluate-accessibility",
      inputMap: {},
      produces: [ARTIFACT_IDS.accessibilityReview],
      execution: { dependsOn: ["assess-severity"] },
      next: ["produce-qa-report"],
    },
    {
      id: "produce-qa-report",
      capabilityId: "produce-qa-report",
      inputMap: {},
      produces: [ARTIFACT_IDS.qaReport],
      execution: { dependsOn: ["evaluate-accessibility"] },
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["qa", "review", "incremental"],
  },
};

/**
 * The approval gate this workflow recommends.
 *
 * `produce-qa-report` is the only `human_gate` capability in the pipeline —
 * the step that publishes a verdict people act on — so it is the one worth a
 * person's attention. The policy is shipped as data rather than wired into
 * the workflow: whether a given deployment gates on it is a host decision,
 * and `ExecutionService` already knows how to evaluate and enforce it.
 */
export const qaReviewApprovalPolicy: ExecutionPolicy = {
  id: "qa-review-approval",
  name: "QA Review approval gate",
  rules: [
    {
      id: "approve-qa-report",
      type: "require_approval",
      target: "produce-qa-report",
      metadata: {
        prompt: "Approve publishing this QA report?",
        reason: "Publishing a verdict the team will act on",
      },
    },
  ],
};
