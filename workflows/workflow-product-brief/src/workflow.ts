// workflows/workflow-product-brief/src/workflow.ts
import type { ExecutionPolicy, WorkflowDefinition } from "@designflow/sdk";
import { ARTIFACT_IDS } from "./types";

/**
 * Product Brief.
 *
 * A linear pipeline: normalize the raw request into a problem statement,
 * scope it, derive requirements from what's in scope, attach measurable
 * acceptance criteria to each requirement, flag risks and assumptions, then
 * assemble everything into one document-shaped brief.
 *
 * Every node declares what it `produces`, so the planner can decide which
 * nodes a change actually invalidates instead of rerunning everything. Each
 * node also depends on the artifact immediately before it in the chain, which
 * is what keeps requirement ids, acceptance-criteria links and the risk
 * register all traceable back to the same problem statement.
 */
export const productBriefWorkflow: WorkflowDefinition = {
  id: "product-brief",
  name: "Product Brief",
  description:
    "Turn a product request into a structured, typed product brief",
  nodes: [
    {
      id: "normalize-product-request",
      capabilityId: "normalize-product-request",
      // The only node fed from the run's input; everything after it reads
      // artifacts.
      inputMap: { $workflowInput: true },
      produces: [ARTIFACT_IDS.problemStatement],
      next: ["define-scope"],
    },
    {
      id: "define-scope",
      capabilityId: "define-scope",
      inputMap: {},
      produces: [ARTIFACT_IDS.scopeDefinition],
      execution: { dependsOn: ["normalize-product-request"] },
      next: ["define-requirements"],
    },
    {
      id: "define-requirements",
      capabilityId: "define-requirements",
      inputMap: {},
      produces: [ARTIFACT_IDS.requirements],
      execution: { dependsOn: ["define-scope"] },
      next: ["define-acceptance-criteria"],
    },
    {
      id: "define-acceptance-criteria",
      capabilityId: "define-acceptance-criteria",
      inputMap: {},
      produces: [ARTIFACT_IDS.acceptanceCriteria],
      execution: { dependsOn: ["define-requirements"] },
      next: ["assess-risks"],
    },
    {
      id: "assess-risks",
      capabilityId: "assess-risks",
      inputMap: {},
      produces: [ARTIFACT_IDS.riskAssumptionRegister],
      execution: { dependsOn: ["define-acceptance-criteria"] },
      next: ["produce-product-brief"],
    },
    {
      id: "produce-product-brief",
      capabilityId: "produce-product-brief",
      inputMap: {},
      produces: [ARTIFACT_IDS.productBrief],
      execution: { dependsOn: ["assess-risks"] },
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["product", "planning", "incremental"],
  },
};

/**
 * The approval gate this workflow recommends.
 *
 * `produce-product-brief` is the step that assembles the final, shareable
 * artifact — the one a person should sign off on before it is treated as the
 * agreed brief — so it is the one worth a person's attention. The policy is
 * shipped as data rather than wired into the workflow: whether a given
 * deployment gates on it is a host decision, and `ExecutionService` already
 * knows how to evaluate and enforce it.
 */
export const productBriefApprovalPolicy: ExecutionPolicy = {
  id: "product-brief-approval",
  name: "Product Brief approval gate",
  rules: [
    {
      id: "approve-product-brief",
      type: "require_approval",
      target: "produce-product-brief",
      metadata: {
        prompt: "Approve the assembled product brief?",
        reason: "Finalizing the brief that downstream planning will rely on",
      },
    },
  ],
};
