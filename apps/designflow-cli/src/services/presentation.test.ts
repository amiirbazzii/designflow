import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { humanizeCapabilityId, type ArtifactSummary } from "@designflow/product";
import { feedbackLoopParentRecordV1Schema } from "@designflow/sdk";

import {
  classifyRunOutcome,
  classifyVisualOutcome,
  describeCapability,
  describeProvenance,
  describeVisualOutcome,
  groupArtifactsByStage,
  isEvidenceArtifact,
  progressLabel,
  projectChildExecutions,
  projectFeedbackLoopIterations,
  readProvenanceFacts,
} from "./presentation";

/**
 * The projection between what a run recorded and what a person reads.
 *
 * Every assertion here is about a claim the CLI must not make: a role where no
 * agent was invoked, provenance an artifact never carried, a relationship
 * between two runs nothing persisted, or an outcome derived from a workflow's
 * name rather than its result.
 */

function artifact(
  artifactId: string,
  overrides: Partial<ArtifactSummary> = {},
): ArtifactSummary {
  return {
    artifactId,
    name: humanizeCapabilityId(artifactId),
    type: "test",
    status: "created",
    dependencies: [],
    ...overrides,
  };
}

// ── Roles and stages ────────────────────────────────────────────

describe("capability presentation", () => {
  test("names a role only for the capabilities that invoke an agent", () => {
    for (const capabilityId of [
      "invoke-figma-specification-agent",
      "invoke-implementation-agent",
      "invoke-visual-validation-agent",
      "invoke-visual-correction-agent",
    ]) {
      expect(describeCapability(capabilityId, capabilityId).kind).toBe("role");
    }
  });

  test("describes every deterministic step as a stage, never as somebody's work", () => {
    for (const capabilityId of [
      "parse-figma-source",
      "retrieve-figma-source-snapshot",
      "inspect-registered-project",
      "map-design-system",
      "request-implementation-approval",
      "create-project-snapshot",
      "apply-approved-file-changes",
      "run-project-validation",
      "capture-implementation-screenshots",
      "compare-visual-evidence",
      "store-stage-4-summary",
    ]) {
      expect(describeCapability(capabilityId, capabilityId).kind).toBe("stage");
    }
  });

  test("the coordinator is never a step, because its decision precedes the run", () => {
    const producer = describeCapability("coordinator", "Coordinator");
    expect(producer.kind).toBe("stage");
  });

  test("an unknown capability keeps the de-slugged label rather than printing an id", () => {
    const label = progressLabel(
      "cap-extract-design-tokens",
      humanizeCapabilityId("cap-extract-design-tokens"),
    );

    expect(label).toBe("Extract design tokens");
    expect(label).not.toContain("cap-");
  });

  test("no known capability renders its raw id", () => {
    for (const capabilityId of [
      "invoke-implementation-agent",
      "run-project-validation",
      "store-stage-5-summary",
    ]) {
      expect(progressLabel(capabilityId, capabilityId)).not.toContain(capabilityId);
    }
  });
});

// ── Artifact grouping ───────────────────────────────────────────

describe("artifact stage grouping", () => {
  test("groups design-journey artifacts in stage order", () => {
    const groups = groupArtifactsByStage([
      artifact("stage-5-summary"),
      artifact("design-specification"),
      artifact("parsed-figma-source"),
      artifact("file-application-result"),
    ]);

    expect(groups?.map((group) => group.stage)).toEqual([
      "Design source",
      "Design specification",
      "Approval and apply",
      "Visual validation",
    ]);
  });

  test("declines to group a run that is not the design journey", () => {
    // A QA review has no stages. One group called "everything" would be a
    // worse list than the plain list the caller falls back to.
    expect(
      groupArtifactsByStage([artifact("review-target-summary"), artifact("qa-report")]),
    ).toBeNull();
  });

  test("keeps unrecognised artifacts of a staged run rather than dropping them", () => {
    const groups = groupArtifactsByStage([
      artifact("design-specification"),
      artifact("something-new"),
    ]);

    expect(groups?.at(-1)?.stage).toBe("Other output");
    expect(groups?.at(-1)?.artifacts[0]?.artifactId).toBe("something-new");
  });

  test("marks captured evidence so its bytes are never printed", () => {
    expect(isEvidenceArtifact("implementation-screenshot-evidence")).toBe(true);
    expect(isEvidenceArtifact("reference-screenshot-evidence")).toBe(true);
    expect(isEvidenceArtifact("dom-and-computed-style-evidence")).toBe(true);
    expect(isEvidenceArtifact("design-specification")).toBe(false);
  });
});

// ── Provenance ──────────────────────────────────────────────────

describe("provenance", () => {
  test("reads a nested agent block and a flat pair alike", () => {
    expect(
      readProvenanceFacts({ agent: { version: "2.0.0", modelProfileId: "spec" } }),
    ).toEqual({ agentVersion: "2.0.0", modelProfileId: "spec" });

    expect(
      readProvenanceFacts({ agentVersion: "9.9.9", modelProfileId: "implementation-alternate" }),
    ).toEqual({ agentVersion: "9.9.9", modelProfileId: "implementation-alternate" });
  });

  test("invents nothing for an artifact that recorded nothing", () => {
    expect(readProvenanceFacts({ projectId: "p" })).toEqual({});
    expect(readProvenanceFacts(undefined)).toEqual({});
  });

  test("a deterministic producer never gains a model profile", () => {
    const lines = describeProvenance("run-project-validation", {
      modelProfileId: "should-not-appear",
    });

    expect(lines.join("\n")).toContain("deterministic step");
    expect(lines.join("\n")).not.toContain("should-not-appear");
  });

  test("an agent artifact reports what it recorded", () => {
    const lines = describeProvenance("invoke-implementation-agent", {
      agentVersion: "9.9.9",
      modelProfileId: "implementation-alternate",
    });

    expect(lines.join("\n")).toContain("9.9.9");
    expect(lines.join("\n")).toContain("implementation-alternate");
  });

  test("a historical artifact missing those fields says so", () => {
    expect(describeProvenance("invoke-implementation-agent", {}).join("\n")).toContain(
      "not recorded in this artifact version",
    );

    expect(describeProvenance(undefined, {}).join("\n")).toContain(
      "not recorded in this artifact version",
    );
  });
});

// ── Related executions ──────────────────────────────────────────

function parentRecord(overrides: Record<string, unknown> = {}) {
  const hash = "a".repeat(64);
  const now = new Date(0).toISOString();

  return feedbackLoopParentRecordV1Schema.parse({
    schemaVersion: "1",
    parentExecutionId: "parent-1",
    workflowId: "design-to-code-feedback-loop",
    state: "completed",
    projectId: "project-1",
    canonicalRootIdentity: hash,
    initialProjectFingerprint: hash,
    currentProjectFingerprint: hash,
    initialImplementationHash: hash,
    currentImplementationHash: hash,
    initialVisualReport: { artifactId: "visual-validation-report", artifactHash: hash, version: "1" },
    currentVisualReport: { artifactId: "visual-validation-report", artifactHash: hash, version: "1" },
    input: {},
    iterationPolicy: {},
    currentIterationNumber: 1,
    maxIterations: 3,
    childExecutionIds: ["child-1"],
    iterations: [
      {
        iterationId: "child-1:1",
        parentExecutionId: "parent-1",
        iterationNumber: 1,
        childExecutionId: "child-1",
        inputVisualReportHash: hash,
        inputProjectFingerprint: hash,
        correctionProposalHash: hash,
        proposalArtifactIds: [],
        approvalIds: ["approval-1"],
        snapshotArtifactIds: ["correction-snapshot"],
        applicationArtifactIds: ["correction-application-result"],
        validationArtifactIds: ["correction-project-validation"],
        rollbackArtifactIds: [],
        visualReportArtifactIds: ["visual-validation-report"],
        status: "completed",
        resolvedFindings: ["f1"],
        remainingFindings: [],
        introducedFindings: [],
        startedAt: now,
      },
    ],
    resolvedFindings: [],
    remainingFindings: [],
    introducedFindings: [],
    cumulativeFileChanges: [],
    rollbackCount: 0,
    sideEffectCounts: {
      childCreation: 1,
      approvalConsumption: 1,
      snapshotCreation: 1,
      correctionApplication: 1,
      rollback: 0,
      projectValidation: 1,
      previewLaunch: 0,
      screenshotCaptureByViewport: {},
      domStyleCollection: 0,
      imageComparison: 0,
      visualReportCreation: 1,
      iterationEvaluation: 1,
      finalReportCreation: 1,
    },
    sideEffects: [],
    traceIds: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe("related executions", () => {
  test("numbers feedback-loop iterations from the persisted record", () => {
    const [iteration] = projectFeedbackLoopIterations(parentRecord());

    expect(iteration?.label).toBe("Iteration 1");
    expect(iteration?.executionId).toBe("child-1");
    expect(iteration?.detailLines.join("\n")).toContain("Status: completed");
    expect(iteration?.detailLines.join("\n")).toContain("Approvals: 1");
    expect(iteration?.detailLines.join("\n")).toContain("Corrections were applied");
    expect(iteration?.detailLines.join("\n")).toContain("Findings resolved: 1");
  });

  test("says the project was restored when the iteration rolled back", () => {
    const record = parentRecord();
    const rolledBack = parentRecord({
      iterations: [
        {
          ...record.iterations[0],
          status: "rolled_back",
          stopReason: "a required check failed",
          rollbackArtifactIds: ["correction-rollback"],
        },
      ],
    });

    const lines = projectFeedbackLoopIterations(rolledBack)[0]?.detailLines.join("\n");

    expect(lines).toContain("restored from its snapshot");
    expect(lines).toContain("a required check failed");
    expect(lines).not.toContain("Corrections were applied");
  });

  test("a parent with no iterations relates to nothing", () => {
    expect(projectFeedbackLoopIterations(parentRecord({ iterations: [] }))).toEqual([]);
  });

  test("generic children are phrased from their own overview", () => {
    const related = projectChildExecutions([
      {
        executionId: "child-9",
        workflowName: "Visual Correction",
        statusLabel: "Completed",
        summary: "Created 4 artifacts",
      },
    ]);

    expect(related[0]?.label).toBe("Visual Correction");
    expect(related[0]?.detailLines).toEqual(["Status: Completed", "Created 4 artifacts"]);
  });

  test("nothing relates two runs that only happened near each other", () => {
    // The projection has no clock and no naming rule: an empty child list is
    // the only thing an unrelated execution can produce.
    expect(projectChildExecutions([])).toEqual([]);
  });
});

// ── Outcomes ────────────────────────────────────────────────────

const BASE_OUTCOME = {
  state: "ready",
  status: "completed",
  hasApplication: false,
  hasSpecification: false,
  hasNamedArtifacts: false,
  rollbackTriggered: false,
  approvalRejected: false,
} as const;

describe("run outcome", () => {
  test("derives each outcome from what the run recorded", () => {
    expect(classifyRunOutcome({ ...BASE_OUTCOME, hasApplication: true })).toBe("applied");
    expect(classifyRunOutcome({ ...BASE_OUTCOME, hasSpecification: true })).toBe(
      "specification-only",
    );
    expect(classifyRunOutcome({ ...BASE_OUTCOME, hasNamedArtifacts: true })).toBe(
      "artifacts-only",
    );
    expect(classifyRunOutcome({ ...BASE_OUTCOME, approvalRejected: true })).toBe("rejected");
    expect(classifyRunOutcome({ ...BASE_OUTCOME, status: "cancelled" })).toBe("cancelled");
    expect(
      classifyRunOutcome({ ...BASE_OUTCOME, state: "failed", rollbackTriggered: true, hasApplication: true }),
    ).toBe("rolled-back");
    expect(classifyRunOutcome({ ...BASE_OUTCOME, state: "failed" })).toBe("nothing-applied");
  });

  test("a rejected run never reads as applied, whatever else it produced", () => {
    expect(
      classifyRunOutcome({ ...BASE_OUTCOME, approvalRejected: true, hasApplication: true }),
    ).toBe("rejected");
  });
});

describe("visual outcome", () => {
  test("reports only the status the report recorded", () => {
    expect(classifyVisualOutcome("pass")).toBe("passed");
    expect(classifyVisualOutcome("pass_with_findings")).toBe("findings");
    expect(classifyVisualOutcome("fail")).toBe("failed");
    expect(classifyVisualOutcome("inconclusive")).toBe("inconclusive");
  });

  test("an absent or unknown status is unavailable, never a pass", () => {
    for (const value of [undefined, null, "", "something-else", 3]) {
      expect(classifyVisualOutcome(value)).toBe("unavailable");
    }

    expect(describeVisualOutcome("unavailable")).not.toContain("passed");
  });
});

// ── Vocabulary ──────────────────────────────────────────────────

describe("presentation vocabulary", () => {
  test("role names are not written down a second time here", () => {
    // `services/readiness.ts` owns the onboarding vocabulary. A literal name
    // in this file would be a second copy that drifts.
    const source = readFileSync(join(import.meta.dir, "presentation.ts"), "utf8");

    expect(source).toContain("designRoleName");
    expect(source).not.toContain("Specialist");
  });
});
