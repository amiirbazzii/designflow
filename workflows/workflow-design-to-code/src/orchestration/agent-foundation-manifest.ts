// workflows/workflow-design-to-code/src/agent-foundation-manifest.ts
import type { WorkflowPackage } from "@designflow/sdk";
import { designToCodeAgentFoundationWorkflow } from "../orchestration/agent-foundation-workflow";
import { agentFoundationCapabilities } from "../orchestration/agent-foundation-capabilities";

/**
 * The installable package for `design-to-code-agent-foundation`.
 *
 * Not loaded by `cli-runner.ts` and not referenced by the Design Engineer
 * worker manifest — a host opts into this workflow explicitly (a test
 * harness, or a future stage's own composition root), the same way any
 * workflow with no worker wrapping it stays reachable only by workflow id.
 */
export const designToCodeAgentFoundationWorkflowPackage: WorkflowPackage = {
  id: "design-to-code-agent-foundation",
  name: "Design → Code (Agent Foundation)",
  version: "0.1.0",
  description: "Specialized-agent invocation and typed artifact handoff proof workflow",
  capabilities: agentFoundationCapabilities.map((capability) => capability.id),
  metadata: {
    author: "DesignFlow Team",
    tags: ["design", "codegen", "agents", "stage-2"],
  },
  definition: designToCodeAgentFoundationWorkflow,
  load(registry) {
    for (const capability of agentFoundationCapabilities) {
      registry.register(capability);
    }
  },
};
