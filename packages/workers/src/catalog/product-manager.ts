// packages/workers/src/catalog/product-manager.ts
import { workerManifestSchema, type WorkerManifest } from "@designflow/sdk";

/**
 * Product Manager.
 *
 * Wraps the `product-brief` workflow. Turns a product request into a
 * structured, typed brief — requirements, acceptance criteria, risks and
 * next actions — never a free-form chat response.
 */
export const productManager: WorkerManifest = workerManifestSchema.parse({
  id: "product-manager",
  name: "Product Manager",
  description: "Turns a product request into a structured brief with requirements and acceptance criteria",
  category: "product",
  workflows: ["product-brief"],
  agentId: "product-manager-agent",
  inputs: [
    {
      key: "productRequest",
      label: "Product request",
      placeholder: "Let users export their history as CSV",
    },
    {
      key: "targetUser",
      label: "Target user",
      placeholder: "Existing DesignFlow CLI users",
    },
    {
      key: "constraints",
      label: "Constraints (comma separated)",
      placeholder: "must ship without a new dependency",
      list: true,
    },
    {
      key: "outputScope",
      label: "Desired output scope",
      placeholder: "standard",
      choices: ["minimal", "standard", "detailed"],
    },
  ],
  evaluationCriteria: [
    {
      id: "user-problem-defined",
      name: "User/problem defined",
      description: "The brief names a target user and the problem being solved",
      type: "boolean",
      required: true,
    },
    {
      id: "acceptance-criteria-measurable",
      name: "Acceptance criteria measurable",
      description: "Every requirement has at least one linked, checkable acceptance criterion",
      type: "boolean",
      required: true,
    },
    {
      id: "risks-and-exclusions-included",
      name: "Risks and exclusions included",
      description: "The brief names at least one risk/assumption and one exclusion",
      type: "boolean",
      required: false,
    },
  ],
  projectContext: {
    relevantFacts: ["projectName", "targetUsers", "productConstraints", "architectureConstraints"],
    relevantMemory: ["preferredPrdFormat", "acceptanceCriteriaStyle", "prioritizationConventions"],
  },
  metadata: {
    author: "DesignFlow",
    tags: ["product", "planning"],
  },
});
