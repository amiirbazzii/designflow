import { describe, expect, test } from "bun:test";
import {
  executionReportSchema,
  type ExecutionReport,
} from "@designflow/product";
import {
  implementationWorkflowInputSchema,
} from "@designflow/workflow-design-to-code";
import {
  assessVisualCorrectionEligibility,
  type EligibilityProjectionInput,
} from "./visual-correction";

function run(state: "ready" | "failed"): ExecutionReport {
  return executionReportSchema.parse({
    overview: {
      executionId: "implementation-run",
      workflowId: "design-to-code-implementation",
      workflowName: "Design to Code",
      status: state === "ready" ? "completed" : "cancelled",
      statusLabel: state === "ready" ? "Completed" : "Cancelled",
      state,
      startedAt: 1,
      artifacts: { created: 0, reused: 0, removed: 0, unchanged: 0, total: 0 },
      summary: "test run",
    },
    narration: [],
    timeline: { executionId: "implementation-run", startedAt: 1, entries: [] },
    artifacts: [],
  });
}

function implementationInput() {
  return implementationWorkflowInputSchema.parse({
    enabled: true,
    designFile: "homepage.fig",
    frames: ["Home"],
    project: { id: "project-1", name: "Fixture", rootPath: "/tmp/fixture" },
    stateDirectory: "/tmp/designflow-state",
    figmaAgentVersion: "0.1.0",
    implementationAgentVersion: "0.1.0",
  });
}

function facts(overrides: Partial<EligibilityProjectionInput> = {}): EligibilityProjectionInput {
  return {
    run: run("ready"),
    implementationInput: implementationInput(),
    artifacts: undefined,
    validationPassed: true,
    validationRolledBack: false,
    currentProjectFingerprint: "fingerprint",
    currentProjectRootIdentity: "root",
    appliedStateFresh: undefined,
    correctionWorkflowRegistered: true,
    pendingApproval: false,
    parent: null,
    actionableFindingCount: 1,
    ...overrides,
  };
}

describe("visual correction eligibility", () => {
  test("specification-only runs are not needed", () => {
    const result = assessVisualCorrectionEligibility({
      ...facts(),
      implementationInput: undefined,
    });
    expect(result.status).toBe("not_needed");
  });

  test("cancelled or failed runs are blocked", () => {
    const result = assessVisualCorrectionEligibility({
      ...facts(),
      run: run("failed"),
    });
    expect(result.status).toBe("blocked");
  });

  test("a pending approval is never treated as a correction baseline", () => {
    const result = assessVisualCorrectionEligibility({
      ...facts(),
      pendingApproval: true,
    });
    expect(result.status).toBe("blocked");
  });

  test("missing persisted artifacts are unavailable", () => {
    const result = assessVisualCorrectionEligibility(facts());
    expect(result.status).toBe("unavailable");
  });

  test("the projection carries the canonical one-iteration bound", () => {
    const result = assessVisualCorrectionEligibility({
      ...facts(),
      implementationInput: undefined,
    });
    expect(result.maximumIterations).toBe(1);
    expect(result.iterationNumber).toBe(1);
  });

  test("an applied run is judged by its post-write hashes, not the pre-apply fingerprint", () => {
    const artifacts = {
      projectContext: { ref: {}, payload: { project: { id: "project-1", rootIdentity: "root", contextFingerprint: "pre-apply-fingerprint" } } },
      visualReport: { ref: {}, payload: { projectId: "project-1", projectRootIdentity: "root", overallStatus: "fail" } },
      appliedFiles: [{ path: "src/App.jsx", postWriteHash: "hash-1" }],
    } as never;
    // Fresh applied state passes the staleness gate even though the current
    // fingerprint no longer equals the pre-apply inspection fingerprint.
    const fresh = assessVisualCorrectionEligibility({
      ...facts(),
      artifacts,
      currentProjectFingerprint: "post-apply-different-fingerprint",
      appliedStateFresh: true,
    });
    expect(fresh.status).not.toBe("blocked");
    // A mutated applied file is stale and blocked.
    const stale = assessVisualCorrectionEligibility({
      ...facts(),
      artifacts,
      currentProjectFingerprint: "post-apply-different-fingerprint",
      appliedStateFresh: false,
    });
    expect(stale.status).toBe("blocked");
    expect(stale.reason).toContain("changed after visual validation");
  });
});
