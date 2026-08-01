// workflows/workflow-research-analysis/src/workflow.ts
import type { ExecutionPolicy, WorkflowDefinition } from "@designflow/sdk";
import { ARTIFACT_IDS } from "./types";

/**
 * Research Analysis.
 *
 * A linear pipeline over a bounded, caller-supplied set of sources: normalize
 * the question and validate the sources, extract discrete claims from the
 * valid ones, cluster claims that address the same aspect of the question and
 * flag agreement or conflict, summarize into key findings, then assemble the
 * final research brief.
 *
 * There is deliberately no capability anywhere in this pipeline that fetches a
 * URL or otherwise browses the web — every source it can ever cite arrives in
 * the workflow input, and every artifact downstream only narrows or
 * reorganizes that fixed list.
 *
 * Every node declares what it `produces`, so the planner can decide which
 * nodes a change actually invalidates instead of rerunning everything.
 */
export const researchAnalysisWorkflow: WorkflowDefinition = {
  id: "research-analysis",
  name: "Research Analysis",
  description:
    "Turn a research question and a bounded set of supplied sources into a cited research brief",
  nodes: [
    {
      id: "normalize-research-question",
      capabilityId: "normalize-research-question",
      // The only node fed from the run's input; everything after it reads
      // artifacts.
      inputMap: { $workflowInput: true },
      produces: [ARTIFACT_IDS.sourceInventory],
      next: ["extract-claims"],
    },
    {
      id: "extract-claims",
      capabilityId: "extract-claims",
      inputMap: {},
      produces: [ARTIFACT_IDS.extractedClaims],
      execution: { dependsOn: ["normalize-research-question"] },
      next: ["compare-findings"],
    },
    {
      id: "compare-findings",
      capabilityId: "compare-findings",
      inputMap: {},
      produces: [ARTIFACT_IDS.comparisonMatrix],
      execution: { dependsOn: ["extract-claims"] },
      next: ["summarize-findings"],
    },
    {
      id: "summarize-findings",
      capabilityId: "summarize-findings",
      inputMap: {},
      produces: [ARTIFACT_IDS.findingsSummary],
      execution: { dependsOn: ["compare-findings"] },
      next: ["produce-research-brief"],
    },
    {
      id: "produce-research-brief",
      capabilityId: "produce-research-brief",
      inputMap: {},
      produces: [ARTIFACT_IDS.researchBrief],
      execution: { dependsOn: ["summarize-findings"] },
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["research", "analysis", "deterministic"],
  },
};

/**
 * The approval gate this workflow recommends.
 *
 * `produce-research-brief` is the workflow's final, externally consumed
 * output — the document a person will actually read and act on — so it is the
 * step worth a person's attention before it is treated as done. The policy is
 * shipped as data rather than wired into the workflow: whether a given
 * deployment gates on it is a host decision, and `ExecutionService` already
 * knows how to evaluate and enforce it.
 */
export const researchAnalysisApprovalPolicy: ExecutionPolicy = {
  id: "research-analysis-approval",
  name: "Research Analysis approval gate",
  rules: [
    {
      id: "approve-research-brief",
      type: "require_approval",
      target: "produce-research-brief",
      metadata: {
        prompt: "Approve the research brief?",
        reason: "Final cited output presented to the requester",
      },
    },
  ],
};
