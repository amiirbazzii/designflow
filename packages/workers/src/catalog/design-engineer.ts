// packages/workers/src/catalog/design-engineer.ts
import { workerManifestSchema, type WorkerManifest } from "@designflow/sdk";

/**
 * Design Engineer.
 *
 * The canonical entry point is the read-only Figma specification journey.
 * The coordinator may subsequently select the consent-gated implementation
 * journey. The generic `design-to-code` scaffold remains a final
 * compatibility alias for historical execution presentation; it is never
 * primary and the public CLI rejects it as an entry point.
 *
 * Parsed at module load, so a malformed manifest fails on import rather than
 * when someone tries to run it.
 */
export const designEngineer: WorkerManifest = workerManifestSchema.parse({
  id: "design-engineer",
  name: "Design Engineer",
  description: "Turns a connected Figma design into an engineering specification or reviewed code changes you approve before anything is written",
  category: "development",
  workflows: [
    "design-to-code-figma-specification",
    "design-to-code-implementation",
    "design-to-code",
  ],
  /**
   * Delegates its decision to the coordinating agent.
   *
   * `workflows` stays: it declares what the catalogue can associate with this
   * worker for routing and historical reads. Its first entry is the only
   * fallback for a consumer without an agent runtime; the final generic entry
   * is retained solely to read pre-productization executions.
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
      key: "request",
      label: "What would you like from this design?",
      placeholder: "Create an engineering specification. Do not modify the project.",
    },
    {
      key: "designFile",
      label: "Figma design URL or file",
      placeholder: "https://www.figma.com/design/...",
    },
    {
      key: "frames",
      label: "Frames (optional, comma separated)",
      placeholder: "brand/Header, brand/Footer, layout/Dashboard",
      list: true,
    },
  ],
  evaluationCriteria: [
    {
      id: "output-validates",
      name: "Output validates",
      description: "The resulting specification or reviewed proposal passes its typed validation",
      type: "boolean",
      required: true,
    },
    {
      id: "expected-artifacts-produced",
      name: "Expected artifacts produced",
      description: "The selected journey produces its required product artifacts",
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
    relevantFacts: ["sourceRoot", "designSystemPath", "componentConventions", "testFramework"],
    relevantMemory: ["componentPlacement", "designSystemPreferences", "testExpectations"],
  },
  metadata: {
    author: "DesignFlow",
    tags: ["design", "frontend", "codegen"],
  },
});
