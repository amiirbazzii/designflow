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
    "Legacy artifacts-only design scaffold (a structural prototype; writes no project files)",
  nodes: [
    {
      id: "analyze-design",
      capabilityId: "analyze-design",
      // Named explicitly rather than `{ $workflowInput: true }`: the
      // capability only ever reads `designFile` and `frames` (see
      // `analyzeDesignCapability` in `capabilities/index.ts`), so mapping the
      // whole input would make a `framework`- or `preferences`-only change
      // invalidate this node too, even though its output never depends on
      // either.
      inputMap: {
        designFile: { $workflowInput: "designFile" },
        frames: { $workflowInput: "frames" },
      },
      produces: [ARTIFACT_IDS.designAnalysis],
      next: ["extract-design-tokens"],
    },
    {
      id: "extract-design-tokens",
      capabilityId: "extract-design-tokens",
      // No node-level input of its own — everything it derives comes from
      // the `design-analysis` artifact, and a change there already changes
      // this node's dependency version. An empty map is correct here, not an
      // oversight: unlike the three nodes below, this capability reads no
      // part of the workflow input directly (see `capabilities/index.ts`).
      inputMap: {},
      produces: [ARTIFACT_IDS.designTokens],
      execution: { dependsOn: ["analyze-design"] },
      next: ["create-component-structure"],
    },
    {
      id: "create-component-structure",
      capabilityId: "create-component-structure",
      // Reads `framework` directly from the workflow input (`readFramework`
      // in `capabilities/index.ts`) rather than from an upstream artifact, so
      // it must be named here — an empty map would let a framework change go
      // undetected by reuse, even though it changes this node's output.
      inputMap: { framework: { $workflowInput: "framework" } },
      produces: [ARTIFACT_IDS.componentTree],
      execution: { dependsOn: ["extract-design-tokens"] },
      next: ["generate-code"],
    },
    {
      id: "generate-code",
      capabilityId: "generate-code",
      // No input of its own — everything it emits comes from the
      // `component-tree` artifact, whose dependency version already carries
      // the framework (and, transitively, the design) forward.
      inputMap: {},
      produces: [ARTIFACT_IDS.sourceCode],
      execution: { dependsOn: ["create-component-structure"] },
      next: ["validate-output"],
    },
    {
      id: "validate-output",
      capabilityId: "validate-output",
      // No input of its own — depends only on the `source-code` artifact it
      // validates.
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
 * `generate-code` is the only `write_fs` capability in the pipeline, so it is
 * the one worth a person's attention. That capability type name describes
 * what a *future* stage of this workflow will do, not what it does today:
 * right now `generate-code` only stores its output as a DesignFlow artifact
 * (see `capabilities/index.ts`) — nothing is written into the project. The
 * gate's own wording must stay honest about that distinction, since it is the
 * text a person actually reads before approving. The policy is shipped as
 * data rather than wired into the workflow: whether a given deployment gates
 * on it is a host decision, and `ExecutionService` already knows how to
 * evaluate and enforce it.
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
        prompt: "Generate and store code as a DesignFlow artifact?",
        reason: "Storing generated code as a DesignFlow artifact — no project files are changed",
      },
    },
  ],
};
