// apps/designflow-cli/src/services/failure-presentation.test.ts
import { describe, expect, test } from "bun:test";

import { buildProductFailure, renderProductFailure } from "./failure-presentation";

const BASE = {
  status: "failed",
  hasApplication: false,
  hasSnapshot: false,
  validationFailed: false,
  rollbackTriggered: false,
} as const;

const EXHAUSTED_ATTEMPTS = [
  { attempt: 1, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "A changed executable module in the proposal does not compile in the project context.", path: "src/pages/NewPage.jsx", compileErrorSummary: 'error during build: | src/pages/NewPage.jsx: Could not resolve "../components/Button"' },
  { attempt: 2, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "A changed executable module in the proposal does not compile in the project context.", path: "src/pages/NewPage.jsx", compileErrorSummary: 'error during build: | src/pages/NewPage.jsx: Could not resolve "../components/Button"' },
  { attempt: 3, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "A changed executable module in the proposal does not compile in the project context.", path: "src/components/Button.jsx", compileErrorSummary: 'Rollup failed to resolve import "prop-types"' },
];

describe("Phase 9 attempt diagnostics rendering", () => {
  test("an exhausted proposal renders every persisted attempt in order with curated labels", () => {
    const failure = buildProductFailure({
      ...BASE,
      errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
      attemptDiagnostics: EXHAUSTED_ATTEMPTS,
    });
    const output = renderProductFailure(failure).join("\n");
    expect(failure.title).toBe("Implementation could not produce a safe change.");
    expect(output.indexOf("Attempt 1")).toBeLessThan(output.indexOf("Attempt 2"));
    expect(output.indexOf("Attempt 2")).toBeLessThan(output.indexOf("Attempt 3"));
    expect(output).toContain("Build check failed");
    expect(output).toContain("src/pages/NewPage.jsx");
    expect(output).toContain('Could not resolve "../components/Button"');
    expect(output).toContain('Rollup failed to resolve import "prop-types"');
    expect(output).toContain("No files were changed.");
  });

  test("validation codes map to curated labels", () => {
    const cases: Array<[string, string]> = [
      ["ERR_PROPOSAL_MODULE_COMPILE_FAILED", "Build check failed"],
      ["ERR_PROPOSAL_TARGET_EXISTS", "Proposed file target was invalid"],
      ["ERR_PROPOSAL_TARGET_MISSING", "Proposed file target was invalid"],
      ["ERR_PROPOSAL_EMPTY_EXECUTABLE_CONTENT", "Proposed change did not contain a meaningful implementation"],
      ["ERR_PROPOSAL_NOOP_MODIFY", "Proposed change did not contain a meaningful implementation"],
      ["ERR_PROPOSAL_COVERAGE_INCOMPLETE", "The proposal did not cover the selected design"],
      ["ERR_UNSAFE_PATH", "The proposal tried to change a file outside the allowed project scope"],
    ];
    for (const [code, label] of cases) {
      const failure = buildProductFailure({
        ...BASE,
        errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
        attemptDiagnostics: [{ attempt: 1, code, message: "m", path: "src/x.jsx" }],
      });
      expect(renderProductFailure(failure).join("\n")).toContain(label);
    }
  });

  test("missing attempt metadata renders truthfully without invented attempts", () => {
    const failure = buildProductFailure({ ...BASE, errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED" });
    const output = renderProductFailure(failure).join("\n");
    expect(output).not.toContain("Attempt 1");
    expect(output).toContain("No files were changed.");
  });

  test("no raw prompts, model output, or secret-bearing fields are shown", () => {
    const failure = buildProductFailure({
      ...BASE,
      errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
      attemptDiagnostics: EXHAUSTED_ATTEMPTS,
      executionId: "run-1",
    });
    const everything = [...renderProductFailure(failure), ...failure.technicalDetails].join("\n");
    for (const forbidden of ["Bearer", "eyJ", "sk-or-v1", "figd_", "prompt", "designSpecification"]) {
      expect(everything).not.toContain(forbidden);
    }
  });

  test("technical details expose bounded codes, paths, operations and the run id", () => {
    const failure = buildProductFailure({
      ...BASE,
      errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
      failedCapabilityId: "invoke-implementation-agent",
      attemptDiagnostics: [{ attempt: 1, code: "ERR_UNSAFE_PATH", message: "m", path: "src/x.jsx", operation: "create" }],
      executionId: "run-42",
    });
    const details = failure.technicalDetails.join("\n");
    expect(details).toContain("Error code: ERR_PROPOSAL_ATTEMPTS_EXHAUSTED");
    expect(details).toContain("Attempt 1: ERR_UNSAFE_PATH · create · src/x.jsx");
    expect(details).toContain("Run id: run-42");
  });
});

describe("Phase 9 mutation-aware failure states", () => {
  test("pre-apply failure says no files were changed", () => {
    const output = renderProductFailure(buildProductFailure({ ...BASE, errorCode: "ERR_MODEL_SERVICE_UNAVAILABLE" })).join("\n");
    expect(output).toContain("No files were changed.");
  });

  test("apply plus successful rollback says project restored", () => {
    const output = renderProductFailure(
      buildProductFailure({ ...BASE, hasApplication: true, hasSnapshot: true, validationFailed: true, rollbackTriggered: true }),
    ).join("\n");
    expect(output).toContain("restored");
    expect(output).not.toContain("No files were changed.");
  });

  test("apply plus missing rollback warns instead of claiming restoration", () => {
    const output = renderProductFailure(
      buildProductFailure({ ...BASE, hasApplication: true, hasSnapshot: true, validationFailed: true, rollbackTriggered: false }),
    ).join("\n");
    expect(output).toContain("Rollback needs attention");
    expect(output).not.toContain("restored");
  });

  test("apply success with later stage failure never claims no files changed", () => {
    const failure = buildProductFailure({
      ...BASE,
      errorCode: "ERR_MODEL_AUTHENTICATION",
      failedCapabilityId: "invoke-visual-validation-agent-stage5",
      hasApplication: true,
      hasSnapshot: true,
    });
    const output = renderProductFailure(failure).join("\n");
    expect(failure.title).toBe("AI session expired.");
    expect(output).toContain("already applied successfully");
    expect(output).toContain("applied and remain in place");
    expect(output).not.toContain("No files were changed.");
  });
});

describe("Phase 9 recovery actions", () => {
  test("authentication failure offers only the supported sign-in recovery", () => {
    const output = renderProductFailure(buildProductFailure({ ...BASE, errorCode: "ERR_MODEL_AUTHENTICATION" })).join("\n");
    expect(output).toContain("Sign in again from the menu");
    expect(output).not.toContain("Retry validation");
  });

  test("rate limit uses retryAfterSeconds", () => {
    const output = renderProductFailure(
      buildProductFailure({ ...BASE, errorCode: "ERR_MODEL_RATE_LIMIT", retryAfterSeconds: 42 }),
    ).join("\n");
    expect(output).toContain("Wait about 42 seconds");
  });

  test("quota exhaustion does not pretend an immediate retry will work", () => {
    const output = renderProductFailure(buildProductFailure({ ...BASE, errorCode: "ERR_MODEL_QUOTA_EXCEEDED" })).join("\n");
    expect(output).toContain("usage limit reached");
    expect(output).toContain("Retrying now will not help");
    expect(output).not.toContain("try again");
  });

  test("Figma node unavailable gives an actionable Desktop recovery", () => {
    const output = renderProductFailure(buildProductFailure({ ...BASE, errorCode: "ERR_FIGMA_NODE_NOT_FOUND" })).join("\n");
    expect(output).toContain("Open the referenced Figma file in Figma Desktop and retry.");
    expect(output).not.toContain("MCP");
  });

  test("insufficient current-selection evidence suggests the pasted URL", () => {
    const output = renderProductFailure(
      buildProductFailure({ ...BASE, errorCode: "ERR_FIGMA_EVIDENCE_INSUFFICIENT" }),
    ).join("\n");
    expect(output).toContain("Paste the frame's Figma URL instead");
  });

  test("proposal exhaustion recovery is an explicit user retry via the menu", () => {
    const output = renderProductFailure(
      buildProductFailure({ ...BASE, errorCode: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED", attemptDiagnostics: EXHAUSTED_ATTEMPTS }),
    ).join("\n");
    expect(output).toContain("start the run again from the menu");
    expect(output).toContain("design and destination are kept");
  });
});

describe("validation-environment failure presentation", () => {
  test("a workspace failure never blames the AI's code and states no files changed", () => {
    const failure = buildProductFailure({
      ...BASE,
      errorCode: "ERR_PROPOSED_STATE_WORKSPACE_FAILED",
    });
    const output = renderProductFailure(failure).join("\n");
    expect(failure.title).toBe("DesignFlow could not validate the proposed change in its temporary workspace.");
    expect(output).toContain("The proposed code was not the problem");
    expect(output).toContain("Your project files were not changed.");
    expect(output).not.toContain("compile");
  });
});
