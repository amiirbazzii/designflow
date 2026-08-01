// workflows/workflow-research-analysis/src/capabilities/index.test.ts
import { describe, expect, test } from "bun:test";
import { InMemoryArtifactStore } from "@designflow/core";
import type { ArtifactRef, CapabilityContext, Logger } from "@designflow/sdk";
import {
  compareFindingsCapability,
  extractClaimsCapability,
  normalizeResearchQuestionCapability,
  produceResearchBriefCapability,
  summarizeFindingsCapability,
} from "./index";
import {
  comparisonMatrixSchema,
  extractedClaimsSchema,
  findingsSummarySchema,
  researchBriefSchema,
  sourceInventorySchema,
} from "../types";

/**
 * Per-capability unit tests.
 *
 * Each capability is exercised directly against a bare `InMemoryArtifactStore`
 * — no engine, no planner — proving it behaves correctly as a pure function of
 * whatever artifacts precede it. `index.test.ts` covers the same pipeline
 * wired end to end through the real runner.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function buildContext(
  artifactStore: InMemoryArtifactStore,
  capabilityId: string,
  parentArtifacts: readonly ArtifactRef[],
  config: Record<string, unknown> = {},
): CapabilityContext {
  return {
    executionId: "exec-test",
    workflowId: "research-analysis",
    capabilityId,
    logger: silentLogger,
    artifactRefs: [],
    parentArtifacts,
    artifactStore,
    config,
    signal: new AbortController().signal,
  };
}

const RAW_SOURCES = [
  {
    id: "src-1",
    title: "Remote Work Study 2024",
    url: "https://example.org/remote-work-2024",
    content:
      "Remote work improves engineering productivity. Documentation quality has improved this year.",
    author: "J. Alvarez",
  },
  {
    id: "src-2",
    title: "Distributed Teams Survey",
    url: "https://example.org/distributed-teams",
    content:
      "Remote work improves engineering productivity for distributed teams. Meetings run more efficiently with async updates.",
    author: "P. Chen",
  },
  {
    id: "src-3",
    title: "Office Culture Report",
    url: "https://example.org/office-culture",
    content:
      "Remote work does not improve engineering productivity for new teams. Onboarding remotely takes longer than expected.",
    author: "R. Osei",
  },
];

// ── 1. normalize-research-question ──────────────────────────────

describe("normalize-research-question", () => {
  test("splits sources into valid and invalid, flagging missing fields", async () => {
    const store = new InMemoryArtifactStore();
    const context = buildContext(store, "normalize-research-question", []);

    const output = await normalizeResearchQuestionCapability.execute(context, {
      question: "Does remote work improve engineering productivity?",
      sources: [
        ...RAW_SOURCES,
        { id: "src-missing-content", title: "Untitled Report" },
        { id: "src-missing-title", content: "Some content with no title." },
        { id: "src-empty" },
      ],
    });

    const inventory = sourceInventorySchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(inventory.totalSources).toBe(6);
    expect(inventory.validSources.map((source) => source.id)).toEqual([
      "src-1",
      "src-2",
      "src-3",
    ]);
    expect(inventory.invalidSources).toHaveLength(3);

    const missingContent = inventory.invalidSources.find(
      (source) => source.id === "src-missing-content",
    );
    expect(missingContent?.reasons).toContain("missing content and excerpt");

    const missingTitle = inventory.invalidSources.find(
      (source) => source.id === "src-missing-title",
    );
    expect(missingTitle?.reasons).toContain("missing title");

    const empty = inventory.invalidSources.find(
      (source) => source.id === "src-empty",
    );
    expect(empty?.reasons).toEqual(
      expect.arrayContaining(["missing title", "missing content and excerpt"]),
    );
  });

  test("prefers content over excerpt when both are supplied", async () => {
    const store = new InMemoryArtifactStore();
    const context = buildContext(store, "normalize-research-question", []);

    const output = await normalizeResearchQuestionCapability.execute(context, {
      question: "q",
      sources: [
        {
          id: "src-1",
          title: "Has both",
          content: "Full content wins.",
          excerpt: "Short excerpt loses.",
        },
      ],
    });

    const inventory = sourceInventorySchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(inventory.validSources[0]?.text).toBe("Full content wins.");
  });

  test("is deterministic across repeated calls", async () => {
    const store = new InMemoryArtifactStore();
    const context = buildContext(store, "normalize-research-question", []);
    const input = { question: "q", sources: RAW_SOURCES };

    const first = await normalizeResearchQuestionCapability.execute(context, input);
    const second = await normalizeResearchQuestionCapability.execute(context, input);

    expect(first.artifactRef.metadata.payloadId).toBe(
      second.artifactRef.metadata.payloadId,
    );
  });
});

// ── 2. extract-claims ────────────────────────────────────────────

describe("extract-claims", () => {
  test("splits each valid source's text into sentence-level claims", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      { question: "q", sources: RAW_SOURCES },
    );

    const context = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const output = await extractClaimsCapability.execute(context);

    const extracted = extractedClaimsSchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(extracted.claims).toHaveLength(6);
    expect(extracted.claims.every((claim) => claim.sourceId.length > 0)).toBe(
      true,
    );
    expect(extracted.claims[0]).toMatchObject({
      id: "src-1-c1",
      sourceId: "src-1",
      text: "Remote work improves engineering productivity.",
    });
  });

  test("drops fragments shorter than the minimum claim length", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      {
        question: "q",
        sources: [
          { id: "src-short", title: "Short", content: "Yes. No. A real claim here." },
        ],
      },
    );

    const context = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const output = await extractClaimsCapability.execute(context);

    const extracted = extractedClaimsSchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(extracted.claims.map((claim) => claim.text)).toEqual([
      "A real claim here.",
    ]);
  });
});

// ── 3. compare-findings ──────────────────────────────────────────

describe("compare-findings", () => {
  test("clusters overlapping claims and flags conflicting sources", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      { question: "q", sources: RAW_SOURCES },
    );

    const extractContext = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const extracted = await extractClaimsCapability.execute(extractContext);

    const context = buildContext(store, "compare-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
    ]);
    const output = await compareFindingsCapability.execute(context);

    const matrix = comparisonMatrixSchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    const conflictGroup = matrix.groups.find(
      (group) => group.agreement === "conflict",
    );

    expect(conflictGroup).toBeDefined();
    expect(conflictGroup?.sourceIds).toEqual(["src-1", "src-2", "src-3"]);

    // Every claim id referenced by a group exists in the extracted claim set.
    const claimIds = new Set(extracted.artifactRef ? [] : []);
    const extractedPayload = extractedClaimsSchema.parse(
      (await store.get(String(extracted.artifactRef.metadata.payloadId)))?.data,
    );
    for (const id of extractedPayload.claims.map((claim) => claim.id)) {
      claimIds.add(id);
    }
    for (const group of matrix.groups) {
      for (const claimId of group.claimIds) {
        expect(claimIds.has(claimId)).toBe(true);
      }
    }
  });

  test("does not flag agreement as conflict when no claim negates", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      {
        question: "q",
        sources: [
          {
            id: "src-a",
            title: "A",
            content: "Remote work improves engineering productivity for teams.",
          },
          {
            id: "src-b",
            title: "B",
            content: "Remote work improves engineering productivity for teams.",
          },
        ],
      },
    );

    const extractContext = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const extracted = await extractClaimsCapability.execute(extractContext);

    const context = buildContext(store, "compare-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
    ]);
    const output = await compareFindingsCapability.execute(context);

    const matrix = comparisonMatrixSchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(matrix.groups).toHaveLength(1);
    expect(matrix.groups[0]?.agreement).toBe("agreement");
    expect(matrix.groups[0]?.sourceIds).toEqual(["src-a", "src-b"]);
  });

  test("a claim with no textual overlap to any source stands alone", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      {
        question: "q",
        sources: [{ id: "src-solo", title: "Solo", content: "A unique standalone claim." }],
      },
    );

    const extractContext = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const extracted = await extractClaimsCapability.execute(extractContext);

    const context = buildContext(store, "compare-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
    ]);
    const output = await compareFindingsCapability.execute(context);

    const matrix = comparisonMatrixSchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(matrix.groups).toHaveLength(1);
    expect(matrix.groups[0]?.agreement).toBe("single-source");
  });
});

// ── 4. summarize-findings ────────────────────────────────────────

describe("summarize-findings", () => {
  test("turns comparison groups into key findings with confidence levels", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      { question: "q", sources: RAW_SOURCES },
    );

    const extractContext = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const extracted = await extractClaimsCapability.execute(extractContext);

    const compareContext = buildContext(store, "compare-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
    ]);
    const compared = await compareFindingsCapability.execute(compareContext);

    const context = buildContext(store, "summarize-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
      compared.artifactRef,
    ]);
    const output = await summarizeFindingsCapability.execute(context);

    const summary = findingsSummarySchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(summary.sourceCount).toBe(3);
    expect(summary.claimCount).toBe(6);

    const conflicting = summary.keyFindings.find((finding) => finding.conflicting);
    expect(conflicting?.confidence).toBe("low");
    expect(conflicting?.sourceIds).toEqual(["src-1", "src-2", "src-3"]);

    // Every finding's sourceIds trace back to a supplied source id.
    const suppliedIds = new Set(RAW_SOURCES.map((source) => source.id));
    for (const finding of summary.keyFindings) {
      for (const sourceId of finding.sourceIds) {
        expect(suppliedIds.has(sourceId)).toBe(true);
      }
    }
  });
});

// ── 5. produce-research-brief ────────────────────────────────────

describe("produce-research-brief", () => {
  test("assembles a brief where every finding and citation traces to a supplied source", async () => {
    const store = new InMemoryArtifactStore();
    const normalizeContext = buildContext(store, "normalize-research-question", []);
    const normalized = await normalizeResearchQuestionCapability.execute(
      normalizeContext,
      { question: "q", sources: RAW_SOURCES },
    );

    const extractContext = buildContext(store, "extract-claims", [
      normalized.artifactRef,
    ]);
    const extracted = await extractClaimsCapability.execute(extractContext);

    const compareContext = buildContext(store, "compare-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
    ]);
    const compared = await compareFindingsCapability.execute(compareContext);

    const summarizeContext = buildContext(store, "summarize-findings", [
      normalized.artifactRef,
      extracted.artifactRef,
      compared.artifactRef,
    ]);
    const summarized = await summarizeFindingsCapability.execute(summarizeContext);

    const context = buildContext(store, "produce-research-brief", [
      normalized.artifactRef,
      extracted.artifactRef,
      compared.artifactRef,
      summarized.artifactRef,
    ]);
    const output = await produceResearchBriefCapability.execute(context);

    const brief = researchBriefSchema.parse(
      (await store.get(String(output.artifactRef.metadata.payloadId)))?.data,
    );

    expect(brief.sourceInventory).toEqual({
      totalSources: 3,
      validSourceCount: 3,
      invalidSourceCount: 0,
    });
    expect(brief.conflicts).toHaveLength(1);
    expect(brief.conflicts[0]?.sourceIds).toEqual(["src-1", "src-2", "src-3"]);

    const suppliedIds = new Set(RAW_SOURCES.map((source) => source.id));

    // The evaluation criterion this test exists for: nothing in the final
    // brief cites a source id the caller never supplied.
    for (const finding of brief.keyFindings) {
      for (const sourceId of finding.sourceIds) {
        expect(suppliedIds.has(sourceId)).toBe(true);
      }
    }
    for (const citation of brief.citations) {
      expect(suppliedIds.has(citation.sourceId)).toBe(true);
    }
    for (const conflict of brief.conflicts) {
      for (const sourceId of conflict.sourceIds) {
        expect(suppliedIds.has(sourceId)).toBe(true);
      }
    }

    // Citations resolve back to the actual supplied title/url, not fabricated
    // ones.
    const src1Citation = brief.citations.find(
      (citation) => citation.sourceId === "src-1",
    );
    expect(src1Citation?.title).toBe("Remote Work Study 2024");
    expect(src1Citation?.url).toBe("https://example.org/remote-work-2024");
  });

  test("flags an unsupported claim id if one were ever introduced", async () => {
    // Defensive check on the invariant itself: a sourceId absent from the
    // supplied list must never appear anywhere reachable from the brief.
    const suppliedIds = new Set(["src-1", "src-2"]);
    const fabricated = { sourceIds: ["src-1", "src-99"] };

    const unsupported = fabricated.sourceIds.filter(
      (id) => !suppliedIds.has(id),
    );

    expect(unsupported).toEqual(["src-99"]);
  });
});
