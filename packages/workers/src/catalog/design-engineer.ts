// packages/workers/src/catalog/design-engineer.ts
import { workerManifestSchema, type WorkerManifest } from "@designflow/sdk";

/**
 * Design Engineer.
 *
 * V2-8: dispatch is deterministic and product-owned. There is deliberately no
 * `agentId` — the Coordinator is not part of the normal Design Engineer
 * execution path. With a design, a project and a destination decision, the
 * product starts the flagship `design-to-code-v2` workflow directly through
 * `startDeterministicSession`; without a project it starts the read-only
 * specification journey. Missing information is a product question, never a
 * model call.
 *
 * `workflows[0]` remains the read-only specification journey: it is the only
 * safe default for a consumer that routes without product context. The legacy
 * `design-to-code-implementation` and `design-to-code` entries are retained
 * for historical execution reads only; the normal path never dispatches them.
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
    "design-to-code-v2",
    "design-to-code-implementation",
    "design-to-code",
  ],
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
      required: true,
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
