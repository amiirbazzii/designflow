// workflows/workflow-design-to-code/src/workflow.ts
import type { ExecutionPolicy, WorkflowDefinition } from "@designflow/sdk";
import { ARTIFACT_IDS } from "./types";

/**
 * Design → Code.
 *
 * A linear compiler pipeline: parse the design, lower it to tokens, plan a
 * component tree, emit source, then validate what was emitted.
 *
 * Two things make this workflow incremental rather than merely sequential:
 *
 * - Every node declares what it `produces`, so the planner can decide which
 *   nodes a change actually invalidates instead of rerunning everything.
 * - `create-component-structure` depends on both the analysis and the tokens.
 *   That second edge is what lets a framework change regenerate the tree and
 *   the code while leaving the analysis and tokens alone.
 */
export const designToCodeWorkflow: WorkflowDefinition = {
  id: "design-to-code",
  name: "Design → Code",
  description:
    "Convert design inputs into production-ready code artifacts",
  nodes: [
    {
      id: "analyze-design",
      capabilityId: "analyze-design",
      // The only node fed from the run's input; everything after it reads
      // artifacts.
      inputMap: { $workflowInput: true },
      produces: [ARTIFACT_IDS.designAnalysis],
      next: ["extract-design-tokens"],
    },
    {
      id: "extract-design-tokens",
      capabilityId: "extract-design-tokens",
      inputMap: {},
      produces: [ARTIFACT_IDS.designTokens],
      execution: { dependsOn: ["analyze-design"] },
      next: ["create-component-structure"],
    },
    {
      id: "create-component-structure",
      capabilityId: "create-component-structure",
      inputMap: {},
      produces: [ARTIFACT_IDS.componentTree],
      execution: { dependsOn: ["extract-design-tokens"] },
      next: ["generate-code"],
    },
    {
      id: "generate-code",
      capabilityId: "generate-code",
      inputMap: {},
      produces: [ARTIFACT_IDS.sourceCode],
      execution: { dependsOn: ["create-component-structure"] },
      next: ["validate-output"],
    },
    {
      id: "validate-output",
      capabilityId: "validate-output",
      inputMap: {},
      produces: [ARTIFACT_IDS.validationReport],
      execution: { dependsOn: ["generate-code"] },
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["design", "codegen", "incremental"],
  },
};

/**
 * The approval gate this workflow recommends.
 *
 * `generate-code` is the only `write_fs` capability in the pipeline — the step
 * that would put files into a project — so it is the one worth a person's
 * attention. The policy is shipped as data rather than wired into the
 * workflow: whether a given deployment gates on it is a host decision, and
 * `ExecutionService` already knows how to evaluate and enforce it.
 */
export const designToCodeApprovalPolicy: ExecutionPolicy = {
  id: "design-to-code-approval",
  name: "Design → Code approval gate",
  rules: [
    {
      id: "approve-code-generation",
      type: "require_approval",
      target: "generate-code",
      metadata: {
        prompt: "Approve generated code changes?",
        reason: "Writing changes to production files",
      },
    },
  ],
};
