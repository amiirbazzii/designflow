// packages/workers/src/catalog/design-engineer.ts
import { workerManifestSchema, type WorkerManifest } from "@designflow/sdk";

/**
 * Design Engineer.
 *
 * Wraps the `design-to-code` workflow. The name is the point: a person hires a
 * design engineer, they do not invoke a design-to-code pipeline.
 *
 * Parsed at module load, so a malformed manifest fails on import rather than
 * when someone tries to run it.
 */
export const designEngineer: WorkerManifest = workerManifestSchema.parse({
  id: "design-engineer",
  name: "Design Engineer",
  description: "Turns a connected Figma design into reviewed code changes you approve before anything is written",
  category: "development",
  workflows: ["design-to-code", "design-to-code-implementation"],
  /**
   * Delegates its decision to the coordinating agent.
   *
   * `workflows` stays: it is what the catalogue advertises, what a host checks
   * against the agent's allow-list, and what this worker falls back to for any
   * consumer that has not wired an agent runtime.
   *
   * Points at `design-engineer-coordinator` (Stage 2) rather than the
   * original `design-engineer-agent` — the coordinator is the new, public
   * routing agent, and `design-engineer-agent` is retained only as a
   * compatibility alias for state (a stored session, a saved trace) that
   * already recorded the old id. See
   * `packages/agents/src/catalog/design-engineer-coordinator.ts`.
   */
  agentId: "design-engineer-coordinator",
  inputs: [
    {
      key: "designFile",
      label: "Design file",
      placeholder: "homepage.fig",
    },
    {
      key: "framework",
      label: "Framework",
      placeholder: "react",
      choices: ["react", "vue", "svelte"],
    },
    {
      key: "frames",
      label: "Frames (comma separated)",
      placeholder: "brand/Header, brand/Footer, layout/Dashboard",
      list: true,
    },
  ],
  evaluationCriteria: [
    {
      id: "output-validates",
      name: "Output validates",
      description: "Generated code passes the workflow's own validation step",
      type: "boolean",
      required: true,
    },
    {
      id: "expected-artifacts-produced",
      name: "Expected artifacts produced",
      description: "Analysis, tokens, component structure and source code artifacts all exist",
      type: "boolean",
      required: true,
    },
    {
      id: "design-system-reuse-detected",
      name: "Design-system reuse detected",
      description: "At least one existing approved component was reused rather than recreated",
      type: "boolean",
      required: false,
    },
  ],
  projectContext: {
    relevantFacts: ["framework", "sourceRoot", "designSystemPath", "componentConventions", "testFramework"],
    relevantMemory: ["componentPlacement", "designSystemPreferences", "testExpectations"],
  },
  metadata: {
    author: "DesignFlow",
    tags: ["design", "frontend", "codegen"],
  },
});
