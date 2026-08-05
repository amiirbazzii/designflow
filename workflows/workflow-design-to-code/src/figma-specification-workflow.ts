// workflows/workflow-design-to-code/src/figma-specification-workflow.ts
import type { WorkflowDefinition } from "@designflow/sdk";

/**
 * Design → Code, Figma Specification (Stage 3).
 *
 * Real path: connect to the configured Figma MCP server, retrieve and
 * normalize the source, invoke the Figma Specification Agent, summarize.
 * Stops at the Design Specification Artifact — no implementation, no
 * visual validation, no code generation, no project file writes. Not the
 * public `design-to-code` workflow, and not reachable from the Design
 * Engineer worker's `workflows` list; see the Stage 3 ADR for the
 * experimental rollout mechanism that does expose it.
 *
 * Every `inputMap` is deliberately narrow, exactly like every other
 * workflow in this package: a node's resolved input is what its reuse
 * fingerprint hashes. `retrieve-figma-source-snapshot` and
 * `invoke-figma-specification-agent` in particular carry almost no input of
 * their own — their reuse identity comes from their upstream artifact's
 * *version*, via `execution.dependsOn`, not from repeating that identity a
 * second time as input.
 */
export const designToCodeFigmaSpecificationWorkflow: WorkflowDefinition = {
  id: "design-to-code-figma-specification",
  name: "Design → Code (Figma Specification)",
  description: "Retrieves a real Figma source and produces an implementation-oriented design specification",
  nodes: [
    {
      id: "parse-figma-source",
      capabilityId: "parse-figma-source",
      inputMap: {
        designFile: { $workflowInput: "designFile" },
        frames: { $workflowInput: "frames" },
        allowFixtureNames: { $workflowInput: "allowFixtureNames" },
      },
      produces: ["parsed-figma-source"],
      next: ["retrieve-figma-source-snapshot"],
    },
    {
      id: "retrieve-figma-source-snapshot",
      capabilityId: "retrieve-figma-source-snapshot",
      inputMap: {
        captureScreenshots: { $workflowInput: "captureScreenshots" },
        refreshFigmaSource: { $workflowInput: "refreshFigmaSource" },
        sourceMode: { $workflowInput: "figmaSourceMode" },
        serverIdentity: { $workflowInput: "figmaServerIdentity" },
      },
      produces: ["figma-source-snapshot"],
      execution: { dependsOn: ["parse-figma-source"] },
      next: ["invoke-figma-specification-agent"],
    },
    {
      id: "invoke-figma-specification-agent",
      capabilityId: "invoke-figma-specification-agent",
      inputMap: {
        agentVersion: { $workflowInput: "figmaAgentVersion" },
        modelProfileId: { $workflowInput: "figmaAgentModelProfileId" },
      },
      produces: ["design-specification"],
      execution: { dependsOn: ["retrieve-figma-source-snapshot"] },
      next: ["store-stage-3-summary"],
    },
    {
      id: "store-stage-3-summary",
      capabilityId: "store-stage-3-summary",
      inputMap: {},
      produces: ["stage-3-summary"],
      execution: { dependsOn: ["invoke-figma-specification-agent"] },
      next: [],
    },
  ],
  metadata: {
    version: "0.1.0",
    author: "DesignFlow Team",
    tags: ["design", "figma", "mcp", "stage-3", "experimental"],
  },
};
