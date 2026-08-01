// packages/workers/src/catalog/qa-reviewer.ts
import { workerManifestSchema, type WorkerManifest } from "@designflow/sdk";

/**
 * QA Reviewer.
 *
 * Wraps the `qa-review` workflow. Reviews generated or existing
 * implementation artifacts for correctness, accessibility and consistency.
 */
export const qaReviewer: WorkerManifest = workerManifestSchema.parse({
  id: "qa-reviewer",
  name: "QA Reviewer",
  description: "Reviews implementation artifacts for correctness, accessibility and consistency",
  category: "quality",
  workflows: ["qa-review"],
  agentId: "qa-reviewer-agent",
  inputs: [
    {
      key: "reviewTarget",
      label: "Review target",
      placeholder: "src/components/Header.tsx",
    },
    {
      key: "reviewScope",
      label: "Review scope",
      placeholder: "correctness, accessibility",
      list: true,
    },
    {
      key: "severityThreshold",
      label: "Severity threshold",
      placeholder: "major",
      choices: ["info", "minor", "major", "blocker"],
    },
  ],
  evaluationCriteria: [
    {
      id: "findings-have-severity",
      name: "Findings have severity",
      description: "Every reported issue carries a severity level",
      type: "boolean",
      required: true,
    },
    {
      id: "accessibility-category-covered",
      name: "Accessibility category covered",
      description: "The report addresses at least one accessibility category",
      type: "boolean",
      required: true,
    },
    {
      id: "report-internally-consistent",
      name: "Report is internally consistent",
      description: "Severity counts in the report match the issue list",
      type: "boolean",
      required: true,
    },
  ],
  projectContext: {
    relevantFacts: ["framework", "testFramework", "accessibilityConventions", "artifactStructure"],
    relevantMemory: ["severityConventions", "accessibilityRequirements", "reviewPreferences"],
  },
  metadata: {
    author: "DesignFlow",
    tags: ["quality", "review", "accessibility"],
  },
});
