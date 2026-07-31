// packages/workers/src/catalog/design-engineer.ts
import { workerManifestSchema } from "@designflow/sdk";
import type { WorkerManifest } from "@designflow/sdk";

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
  description: "Transforms designs into production-ready applications",
  category: "development",
  workflows: ["design-to-code"],
  /**
   * Delegates its decision to an agent.
   *
   * `workflows` stays: it is what the catalogue advertises, what a host checks
   * against the agent's allow-list, and what this worker falls back to for any
   * consumer that has not wired an agent runtime.
   */
  agentId: "design-engineer-agent",
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
  metadata: {
    author: "DesignFlow",
    tags: ["design", "frontend", "codegen"],
  },
});
