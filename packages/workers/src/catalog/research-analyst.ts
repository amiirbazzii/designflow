// packages/workers/src/catalog/research-analyst.ts
import { workerManifestSchema } from "@designflow/sdk";
import type { WorkerManifest } from "@designflow/sdk";

/**
 * Research Analyst.
 *
 * Wraps the `research-analysis` workflow. Organizes a bounded research
 * request over explicitly supplied sources — no unrestricted browsing.
 */
export const researchAnalyst: WorkerManifest = workerManifestSchema.parse({
  id: "research-analyst",
  name: "Research Analyst",
  description: "Synthesizes supplied sources into structured findings and citations",
  category: "research",
  workflows: ["research-analysis"],
  agentId: "research-analyst-agent",
  inputs: [
    {
      key: "researchQuestion",
      label: "Research question",
      placeholder: "What are the tradeoffs of server components vs. client components?",
    },
    {
      key: "sources",
      label: "Supplied sources (comma separated)",
      placeholder: "source-1, source-2",
      list: true,
    },
    {
      key: "reportDepth",
      label: "Report depth",
      placeholder: "standard",
      choices: ["quick", "standard", "deep"],
    },
  ],
  evaluationCriteria: [
    {
      id: "claims-linked-to-sources",
      name: "Claims linked to supplied sources",
      description: "Every claim in the brief cites a supplied source id",
      type: "boolean",
      required: true,
    },
    {
      id: "conflicting-findings-identified",
      name: "Conflicting findings identified",
      description: "Disagreement between sources is flagged when present",
      type: "boolean",
      required: false,
    },
    {
      id: "unsupported-claims-flagged",
      name: "Unsupported claims flagged",
      description: "No claim in the brief lacks a source id",
      type: "count",
      required: true,
    },
  ],
  projectContext: {
    relevantFacts: ["domain", "approvedSourcePolicy"],
    relevantMemory: ["preferredReportStructure", "approvedSourceQualityStandards", "citationPreferences"],
  },
  metadata: {
    author: "DesignFlow",
    tags: ["research", "analysis"],
  },
});
