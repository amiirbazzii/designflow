// workflows/workflow-qa-review/src/capabilities.test.ts
import { describe, expect, test } from "bun:test";
import { InMemoryArtifactStore } from "@designflow/core";
import type { ArtifactRef, CapabilityContext, Logger } from "@designflow/sdk";
import {
  assessSeverityCapability,
  collectReviewTargetCapability,
  evaluateAccessibilityCapability,
  evaluateCorrectnessCapability,
  produceQaReportCapability,
} from "./capabilities/index";
import {
  ARTIFACT_IDS,
  accessibilityReviewSchema,
  issueListSchema,
  qaReportSchema,
  reviewTargetSummarySchema,
  severityAssessmentSchema,
} from "./types";

/**
 * Unit tests for each capability's `execute`, run directly against a bare
 * `InMemoryArtifactStore` rather than the full engine.
 *
 * `writeArtifact`/`readArtifact` only need an `ArtifactStore` (`save`/`get`)
 * and a node's `parentArtifacts` — both of which this file wires up by hand —
 * so exercising a capability standalone needs no execution service, no
 * planner, and no workflow definition. `index.test.ts` covers the same
 * capabilities wired into the real DAG.
 */

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeContext(
  artifactStore: InMemoryArtifactStore,
  capabilityId: string,
  parentArtifacts: readonly ArtifactRef[],
  config: Record<string, unknown> = {},
): CapabilityContext {
  return {
    executionId: "exec-1",
    workflowId: "qa-review",
    capabilityId,
    logger: silentLogger,
    artifactRefs: [],
    parentArtifacts,
    artifactStore,
    config,
    signal: new AbortController().signal,
  };
}

const TARGET_INPUT = {
  id: "checkout-flow",
  description: "Checkout flow implementation",
  scope: ["ui"],
  severityThreshold: "minor" as const,
  items: [
    {
      path: "src/components/CheckoutButton.tsx",
      kind: "component",
      content: '<div onClick={submit}>#fff Pay now</div>',
    },
    {
      path: "src/components/CheckoutSummary.tsx",
      kind: "component",
      content: "<section>Summary</section>",
    },
    {
      path: "src/components/CheckoutForm.tsx",
      kind: "component",
    },
  ],
};

describe("collect-review-target", () => {
  test("normalizes the input into a review target summary", async () => {
    const store = new InMemoryArtifactStore();
    const context = makeContext(store, "collect-review-target", []);

    const output = await collectReviewTargetCapability.execute(context, TARGET_INPUT);

    expect(output.artifactRef.id).toBe(ARTIFACT_IDS.reviewTargetSummary);

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const summary = reviewTargetSummarySchema.parse(stored?.data);

    expect(summary.itemCount).toBe(3);
    expect(summary.kinds).toEqual(["component"]);
    expect(summary.missingContentPaths).toEqual([
      "src/components/CheckoutForm.tsx",
    ]);
  });

  test("rejects an item without a path", async () => {
    const store = new InMemoryArtifactStore();
    const context = makeContext(store, "collect-review-target", []);

    await expect(
      collectReviewTargetCapability.execute(context, {
        id: "bad",
        description: "bad input",
        items: [{ path: "", kind: "component" }],
      }),
    ).rejects.toThrow();
  });
});

describe("evaluate-correctness", () => {
  test("flags missing content and duplicate paths", async () => {
    const store = new InMemoryArtifactStore();
    const collectContext = makeContext(store, "collect-review-target", []);
    const collected = await collectReviewTargetCapability.execute(
      collectContext,
      {
        id: "with-duplicates",
        description: "duplicate paths",
        items: [
          { path: "src/a.tsx", kind: "component", content: "<a />" },
          { path: "src/a.tsx", kind: "component", content: "<a />" },
          { path: "src/b.tsx", kind: "test" },
        ],
      },
    );

    const context = makeContext(store, "evaluate-correctness", [
      collected.artifactRef,
    ]);
    const output = await evaluateCorrectnessCapability.execute(context);

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const issueList = issueListSchema.parse(stored?.data);

    // "src/b.tsx" is both missing content and mislabeled as a test.
    expect(issueList.issues.map((issue) => issue.id)).toEqual([
      "completeness:src/b.tsx",
      "consistency:src/a.tsx",
      "correctness:src/b.tsx",
    ]);
  });

  test("flags an item marked as a test whose path does not look like one", async () => {
    const store = new InMemoryArtifactStore();
    const collectContext = makeContext(store, "collect-review-target", []);
    const collected = await collectReviewTargetCapability.execute(
      collectContext,
      {
        id: "mislabeled",
        description: "mislabeled test",
        items: [{ path: "src/helpers.ts", kind: "test", content: "export {}" }],
      },
    );

    const context = makeContext(store, "evaluate-correctness", [
      collected.artifactRef,
    ]);
    const output = await evaluateCorrectnessCapability.execute(context);

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const issueList = issueListSchema.parse(stored?.data);

    expect(issueList.issues).toEqual([
      {
        id: "correctness:src/helpers.ts",
        description:
          'Item "src/helpers.ts" is marked as kind "test" but its path does not look like a test file',
        kind: "correctness",
        location: "src/helpers.ts",
      },
    ]);
  });

  test("throws when the review target summary is missing", async () => {
    const store = new InMemoryArtifactStore();
    const context = makeContext(store, "evaluate-correctness", []);

    await expect(evaluateCorrectnessCapability.execute(context)).rejects.toThrow();
  });
});

describe("assess-severity", () => {
  test("tags issues by kind and flags those at or above the threshold", async () => {
    const store = new InMemoryArtifactStore();

    const collected = await collectReviewTargetCapability.execute(
      makeContext(store, "collect-review-target", []),
      TARGET_INPUT,
    );
    const issued = await evaluateCorrectnessCapability.execute(
      makeContext(store, "evaluate-correctness", [collected.artifactRef]),
    );
    const output = await assessSeverityCapability.execute(
      makeContext(store, "assess-severity", [
        collected.artifactRef,
        issued.artifactRef,
      ]),
    );

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const assessment = severityAssessmentSchema.parse(stored?.data);

    expect(assessment.threshold).toBe("minor");
    expect(assessment.counts).toEqual({ blocker: 1, major: 0, minor: 0, info: 0 });
    expect(assessment.flaggedIssueIds).toEqual([
      "completeness:src/components/CheckoutForm.tsx",
    ]);
  });

  test("does not flag issues below the severity threshold", async () => {
    const store = new InMemoryArtifactStore();

    const collected = await collectReviewTargetCapability.execute(
      makeContext(store, "collect-review-target", []),
      {
        id: "minor-only",
        description: "only a correctness issue",
        severityThreshold: "major",
        items: [{ path: "src/helpers.ts", kind: "test", content: "export {}" }],
      },
    );
    const issued = await evaluateCorrectnessCapability.execute(
      makeContext(store, "evaluate-correctness", [collected.artifactRef]),
    );
    const output = await assessSeverityCapability.execute(
      makeContext(store, "assess-severity", [
        collected.artifactRef,
        issued.artifactRef,
      ]),
    );

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const assessment = severityAssessmentSchema.parse(stored?.data);

    // "correctness" issues assess as "minor", below the "major" threshold.
    expect(assessment.counts.minor).toBe(1);
    expect(assessment.flaggedIssueIds).toEqual([]);
  });
});

describe("evaluate-accessibility", () => {
  test("finds aria, contrast, keyboard, and semantics gaps", async () => {
    const store = new InMemoryArtifactStore();

    const collected = await collectReviewTargetCapability.execute(
      makeContext(store, "collect-review-target", []),
      TARGET_INPUT,
    );
    const output = await evaluateAccessibilityCapability.execute(
      makeContext(store, "evaluate-accessibility", [collected.artifactRef]),
    );

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const review = accessibilityReviewSchema.parse(stored?.data);

    expect(review.counts).toEqual({ aria: 1, contrast: 1, keyboard: 1, semantics: 1 });
    expect(review.findings.map((finding) => finding.category)).toEqual([
      "aria",
      "contrast",
      "keyboard",
      "semantics",
    ]);
  });

  test("skips items without content and non-interactive markup", async () => {
    const store = new InMemoryArtifactStore();

    const collected = await collectReviewTargetCapability.execute(
      makeContext(store, "collect-review-target", []),
      {
        id: "quiet",
        description: "nothing interactive",
        items: [
          { path: "src/no-content.tsx", kind: "component" },
          {
            path: "src/static.tsx",
            kind: "component",
            content: "<p>Just text</p>",
          },
        ],
      },
    );
    const output = await evaluateAccessibilityCapability.execute(
      makeContext(store, "evaluate-accessibility", [collected.artifactRef]),
    );

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const review = accessibilityReviewSchema.parse(stored?.data);

    expect(review.findings).toEqual([]);
    expect(review.counts).toEqual({ aria: 0, contrast: 0, keyboard: 0, semantics: 0 });
  });
});

describe("produce-qa-report", () => {
  test("publishes a failing verdict when issues are flagged", async () => {
    const store = new InMemoryArtifactStore();

    const collected = await collectReviewTargetCapability.execute(
      makeContext(store, "collect-review-target", []),
      TARGET_INPUT,
    );
    const issued = await evaluateCorrectnessCapability.execute(
      makeContext(store, "evaluate-correctness", [collected.artifactRef]),
    );
    const assessed = await assessSeverityCapability.execute(
      makeContext(store, "assess-severity", [
        collected.artifactRef,
        issued.artifactRef,
      ]),
    );
    const reviewed = await evaluateAccessibilityCapability.execute(
      makeContext(store, "evaluate-accessibility", [collected.artifactRef]),
    );

    const output = await produceQaReportCapability.execute(
      makeContext(store, "produce-qa-report", [
        assessed.artifactRef,
        reviewed.artifactRef,
      ]),
    );

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const report = qaReportSchema.parse(stored?.data);

    expect(report.targetId).toBe("checkout-flow");
    expect(report.verdict).toBe("fail");
    expect(report.issueCount).toBe(1);
    expect(report.flaggedIssueCount).toBe(1);
    expect(report.accessibilityFindingCount).toBe(4);
  });

  test("publishes a passing verdict when nothing is flagged", async () => {
    const store = new InMemoryArtifactStore();

    const collected = await collectReviewTargetCapability.execute(
      makeContext(store, "collect-review-target", []),
      {
        id: "clean",
        description: "clean implementation",
        items: [
          { path: "src/clean.tsx", kind: "component", content: "<p>Fine</p>" },
        ],
      },
    );
    const issued = await evaluateCorrectnessCapability.execute(
      makeContext(store, "evaluate-correctness", [collected.artifactRef]),
    );
    const assessed = await assessSeverityCapability.execute(
      makeContext(store, "assess-severity", [
        collected.artifactRef,
        issued.artifactRef,
      ]),
    );
    const reviewed = await evaluateAccessibilityCapability.execute(
      makeContext(store, "evaluate-accessibility", [collected.artifactRef]),
    );

    const output = await produceQaReportCapability.execute(
      makeContext(store, "produce-qa-report", [
        assessed.artifactRef,
        reviewed.artifactRef,
      ]),
    );

    const stored = await store.get(String(output.artifactRef.metadata.payloadId));
    const report = qaReportSchema.parse(stored?.data);

    expect(report.verdict).toBe("pass");
    expect(report.flaggedIssueCount).toBe(0);
  });
});
