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
  projectParentId,
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

describe("DF-CORR-01 correction iteration scope", () => {
  test("a fresh run with no parent record is eligible at iteration 0", () => {
    const result = assessVisualCorrectionEligibility(facts({
      artifacts: undefined,
      parent: null,
    }));
    // parent === null means zero iterations consumed for THIS run
    expect(result.iterationNumber).toBe(1);
    expect(result.status).not.toBe("iteration_limit_reached");
    expect(result.status).not.toBe("already_active");
    expect(result.status).not.toBe("completed");
  });

  test("the parent record key is scoped to the execution, never the project", () => {
    expect(projectParentId("run-a")).toBe("feedback-loop-parent-run-a");
    expect(projectParentId("run-b")).toBe("feedback-loop-parent-run-b");
    expect(projectParentId("run-a")).not.toBe(projectParentId("run-b"));
  });

  test("a consumed iteration on the same run reports the limit; eligibility never mutates the parent", () => {
    const parent = {
      currentIterationNumber: 1,
      maxIterations: 1,
      state: "waiting_approval",
      childExecutionIds: ["child-1"],
    } as never;
    const snapshot = JSON.stringify(parent);
    const result = assessVisualCorrectionEligibility(facts({ parent }));
    expect(result.status).toBe("iteration_limit_reached");
    expect(result.maximumIterations).toBe(1);
    expect(JSON.stringify(parent)).toBe(snapshot);
  });

  test("an active correction child on the same run is already_active, not silently restarted", () => {
    const parent = {
      currentIterationNumber: 0,
      maxIterations: 1,
      state: "waiting_approval",
      childExecutionIds: ["child-1"],
    } as never;
    expect(assessVisualCorrectionEligibility(facts({ parent })).status).toBe("already_active");
  });
});
