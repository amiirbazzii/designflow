// packages/sdk/src/execution-contract.test.ts
import { describe, expect, test } from "bun:test";
import {
  executionRequestSchema,
  executionResultSchema,
  executionRequestOptionsSchema,
  executionErrorSchema,
  boundedAttemptDiagnostics,
  proposalAttemptDiagnosticSchema,
} from "./execution-contract";

describe("Execution Contract Schemas", () => {
  describe("executionRequestSchema", () => {
    test("valid request with all fields", () => {
      const request = {
        workflowId: "test-wf",
        input: { key: "value" },
        metadata: { source: "cli" },
        options: {
          dryRun: true,
          resume: false,
        },
      };

      const result = executionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workflowId).toBe("test-wf");
        expect(result.data.input).toEqual({ key: "value" });
        expect(result.data.metadata).toEqual({ source: "cli" });
        expect(result.data.options?.dryRun).toBe(true);
        expect(result.data.options?.resume).toBe(false);
      }
    });

    test("valid request with only workflowId", () => {
      const request = {
        workflowId: "test-wf",
      };

      const result = executionRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workflowId).toBe("test-wf");
        expect(result.data.input).toBeUndefined();
        expect(result.data.metadata).toBeUndefined();
        expect(result.data.options).toBeUndefined();
      }
    });

    test("invalid request with empty workflowId", () => {
      const request = {
        workflowId: "",
      };

      const result = executionRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });

    test("invalid request with missing workflowId", () => {
      const request = {};

      const result = executionRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });

    test("options schema validates correctly", () => {
      const options1 = { dryRun: true };
      const options2 = { resume: true };
      const options3 = { dryRun: false, resume: true };

      expect(executionRequestOptionsSchema.safeParse(options1).success).toBe(true);
      expect(executionRequestOptionsSchema.safeParse(options2).success).toBe(true);
      expect(executionRequestOptionsSchema.safeParse(options3).success).toBe(true);
      expect(executionRequestOptionsSchema.safeParse({}).success).toBe(true);
    });
  });

  describe("executionResultSchema", () => {
    test("valid completed result", () => {
      const result = {
        executionId: "exec-123",
        workflowId: "test-wf",
        status: "completed" as const,
        artifacts: [
          { id: "artifact-1", type: "test", metadata: {} },
        ],
      };

      const parsed = executionResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.executionId).toBe("exec-123");
        expect(parsed.data.workflowId).toBe("test-wf");
        expect(parsed.data.status).toBe("completed");
        expect(parsed.data.artifacts).toHaveLength(1);
        expect(parsed.data.error).toBeUndefined();
      }
    });

    test("valid failed result with error", () => {
      const result = {
        executionId: "exec-123",
        workflowId: "test-wf",
        status: "failed" as const,
        artifacts: [],
        error: {
          code: "EXECUTION_ERROR",
          message: "Something went wrong",
        },
      };

      const parsed = executionResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("failed");
        expect(parsed.data.error).toBeDefined();
        expect(parsed.data.error?.code).toBe("EXECUTION_ERROR");
        expect(parsed.data.error?.message).toBe("Something went wrong");
      }
    });

    test("valid cancelled result", () => {
      const result = {
        executionId: "exec-123",
        workflowId: "test-wf",
        status: "cancelled" as const,
        artifacts: [],
      };

      const parsed = executionResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.status).toBe("cancelled");
      }
    });

    test("invalid status is rejected", () => {
      const result = {
        executionId: "exec-123",
        workflowId: "test-wf",
        status: "invalid",
        artifacts: [],
      };

      const parsed = executionResultSchema.safeParse(result);
      expect(parsed.success).toBe(false);
    });

    test("missing required fields are rejected", () => {
      const result = {
        executionId: "exec-123",
        // missing workflowId
        status: "completed",
        artifacts: [],
      };

      const parsed = executionResultSchema.safeParse(result);
      expect(parsed.success).toBe(false);
    });

    test("artifacts are validated", () => {
      const result = {
        executionId: "exec-123",
        workflowId: "test-wf",
        status: "completed" as const,
        artifacts: [
          { id: "a1", type: "type1" },
          { id: "a2", type: "type2", metadata: { key: "value" } },
        ],
      };

      const parsed = executionResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.artifacts).toHaveLength(2);
        expect(parsed.data.artifacts[0].metadata).toEqual({});
      }
    });
  });

  describe("executionErrorSchema", () => {
    test("valid error", () => {
      const error = {
        code: "ERR_SOMETHING",
        message: "Something went wrong",
      };

      const parsed = executionErrorSchema.safeParse(error);
      expect(parsed.success).toBe(true);
    });

    test("invalid error with empty code", () => {
      const error = {
        code: "",
        message: "Something went wrong",
      };

      const parsed = executionErrorSchema.safeParse(error);
      expect(parsed.success).toBe(false);
    });

    test("invalid error with empty message", () => {
      const error = {
        code: "ERR_SOMETHING",
        message: "",
      };

      const parsed = executionErrorSchema.safeParse(error);
      expect(parsed.success).toBe(false);
    });
  });
});

// ── Phase 7D: bounded attempt diagnostics ────────────────────────

describe("boundedAttemptDiagnostics", () => {
  test("keeps fact fields for every attempt and preserves order", () => {
    const result = boundedAttemptDiagnostics([
      { attempt: 1, code: "ERR_A", message: "first", path: "src/a.jsx", operation: "modify" },
      { attempt: 2, code: "ERR_B", message: "second", targetId: "frame:n1", targetKind: "frame", fact: "a fact" },
      { attempt: 3, code: "ERR_C", message: "third", compileErrorSummary: "src/a.jsx: No matching export" },
    ])!;
    expect(result.length).toBe(3);
    expect(result.map((d) => d.attempt)).toEqual([1, 2, 3]);
    expect(result[0]).toEqual({ attempt: 1, code: "ERR_A", message: "first", path: "src/a.jsx", operation: "modify" });
    expect(result[1]!.fact).toBe("a fact");
    expect(result[2]!.compileErrorSummary).toBe("src/a.jsx: No matching export");
  });

  test("truncates oversized strings to the schema bounds", () => {
    const result = boundedAttemptDiagnostics([
      { attempt: 1, code: "ERR_LONG", message: "m".repeat(5000), compileErrorSummary: "c".repeat(5000) },
    ])!;
    expect(result[0]!.message.length).toBe(600);
    expect(result[0]!.compileErrorSummary!.length).toBe(1200);
    expect(proposalAttemptDiagnosticSchema.safeParse(result[0]).success).toBe(true);
  });

  test("caps the list at 12 entries and drops malformed ones", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ attempt: i + 1, code: "ERR", message: "m" }));
    expect(boundedAttemptDiagnostics(many)!.length).toBe(12);
    expect(boundedAttemptDiagnostics([{ notAnAttempt: true }, null, "text"])).toBeUndefined();
    expect(boundedAttemptDiagnostics([])).toBeUndefined();
    expect(boundedAttemptDiagnostics("not-an-array")).toBeUndefined();
  });

  test("executionErrorSchema accepts bounded attemptDiagnostics", () => {
    const parsed = executionErrorSchema.safeParse({
      code: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED",
      message: "The proposal remained invalid after 3 bounded attempts",
      attemptDiagnostics: [{ attempt: 1, code: "ERR_A", message: "m" }],
    });
    expect(parsed.success).toBe(true);
  });
});
