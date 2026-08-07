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
});
