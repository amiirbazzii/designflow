// packages/product/src/worker-evaluation-service.test.ts
import { describe, expect, test } from "bun:test";
import type { WorkerCriterionEvaluator, WorkerEvaluationCriterion, WorkerManifest } from "@designflow/sdk";
import { evaluateWorkerResult } from "./worker-evaluation-service";
import type { ArtifactSummary, ExecutionOverview } from "./schemas";

/**
 * Proves the generic aggregation layer — `evaluateWorkerResult` itself,
 * independent of any real worker's criteria — using a small hand-written
 * fake evaluator rather than a real workflow's Zod schemas. The actual
 * per-worker deterministic checks (QA Reviewer, Research Analyst, Product
 * Manager, Design Engineer) now live, and are tested, in each workflow
 * package's own `evaluate.test.ts`, since only that package can safely
 * import its own artifact schemas.
 */

function overviewFixture(overrides?: Partial<ExecutionOverview>): ExecutionOverview {
  return {
    executionId: "exec-1",
    workflowId: "some-workflow",
    workflowName: "Some Workflow",
    status: "completed",
    statusLabel: "Completed",
    state: "ready",
    startedAt: 1_000,
    completedAt: 2_000,
    artifacts: { created: 1, reused: 0, removed: 0, unchanged: 0, total: 1 },
    summary: "Finished.",
    ...overrides,
  };
}

function artifact(id: string, overrides?: Partial<ArtifactSummary>): ArtifactSummary {
  return {
    artifactId: id,
    name: id,
    type: "test-artifact",
    status: "created",
    dependencies: [],
    ...overrides,
  };
}

function criterion(id: string, required: boolean): WorkerEvaluationCriterion {
  return {
    id,
    name: id,
    description: id,
    type: "boolean",
    required,
  };
}

function workerFixture(criteria: readonly WorkerEvaluationCriterion[]): WorkerManifest {
  return {
    id: "test-worker",
    name: "Test Worker",
    description: "A worker used only to exercise the generic aggregation layer.",
    category: "test",
    workflows: ["some-workflow"],
    inputs: [],
    evaluationCriteria: criteria,
  };
}

/** Satisfied exactly when the criterion id is "always-pass". */
const fakeEvaluator: WorkerCriterionEvaluator = (criterionId) => ({
  criterionId,
  satisfied: criterionId === "always-pass",
});

describe("evaluateWorkerResult", () => {
  test("aggregates required criteria using the caller-supplied evaluator", () => {
    const worker = workerFixture([criterion("always-pass", true), criterion("always-fail", true)]);

    const summary = evaluateWorkerResult(
      worker,
      [artifact("some-artifact")],
      overviewFixture(),
      { "test-worker": fakeEvaluator },
    );

    expect(summary.requiredTotal).toBe(2);
    expect(summary.requiredSatisfied).toBe(1);

    const pass = summary.results.find((r) => r.criterionId === "always-pass");
    const fail = summary.results.find((r) => r.criterionId === "always-fail");
    expect(pass?.satisfied).toBe(true);
    expect(fail?.satisfied).toBe(false);
  });

  test("a non-required criterion does not count toward requiredTotal", () => {
    const worker = workerFixture([criterion("always-pass", true), criterion("always-fail", false)]);

    const summary = evaluateWorkerResult(
      worker,
      [],
      overviewFixture(),
      { "test-worker": fakeEvaluator },
    );

    expect(summary.requiredTotal).toBe(1);
    expect(summary.requiredSatisfied).toBe(1);
  });

  test("a worker with no registered evaluator reports every criterion as undecidable", () => {
    const worker = workerFixture([criterion("always-pass", true)]);

    const summary = evaluateWorkerResult(worker, [], overviewFixture(), {});

    expect(summary.requiredSatisfied).toBe(0);
    const result = summary.results.find((r) => r.criterionId === "always-pass");
    expect(result?.satisfied).toBeUndefined();
    expect(result?.note).toContain("test-worker");
  });

  test("an execution that has not reached the ready state cannot be evaluated deterministically", () => {
    const worker = workerFixture([criterion("always-pass", true)]);

    const summary = evaluateWorkerResult(
      worker,
      [],
      overviewFixture({ state: "failed", summary: "did not finish." }),
      { "test-worker": fakeEvaluator },
    );

    expect(summary.results.every((r) => r.satisfied === undefined)).toBe(true);
    expect(summary.requiredSatisfied).toBe(0);
  });
});
