import { describe, expect, test } from "bun:test";
import {
  artifactReconciliationInputSchema,
  artifactReconciliationResultSchema,
  reconciliationReportSchema,
} from "./execution-reconciliation";
import { artifactRefSchema } from "./schemas";
import { executionEventTypeSchema } from "./execution-events";

describe("artifactReconciliationInputSchema", () => {
  test("defaults every artifact list", () => {
    const parsed = artifactReconciliationInputSchema.parse({
      executionId: "exec-1",
    });

    expect(parsed.previousArtifacts).toEqual([]);
    expect(parsed.reusedArtifacts).toEqual([]);
    expect(parsed.producedArtifacts).toEqual([]);
  });

  test("rejects a missing executionId", () => {
    expect(artifactReconciliationInputSchema.safeParse({}).success).toBe(false);
    expect(
      artifactReconciliationInputSchema.safeParse({ executionId: "" }).success,
    ).toBe(false);
  });

  test("validates each artifact reference", () => {
    const result = artifactReconciliationInputSchema.safeParse({
      executionId: "exec-1",
      producedArtifacts: [{ type: "test" }],
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactReconciliationResultSchema", () => {
  test("defaults every id list", () => {
    const parsed = artifactReconciliationResultSchema.parse({
      executionId: "exec-1",
    });

    expect(parsed.artifacts).toEqual([]);
    expect(parsed.reusedArtifactIds).toEqual([]);
    expect(parsed.producedArtifactIds).toEqual([]);
    expect(parsed.removedArtifactIds).toEqual([]);
  });

  test("accepts a populated result", () => {
    const parsed = artifactReconciliationResultSchema.parse({
      executionId: "exec-2",
      artifacts: [{ id: "ui-ir", type: "test", version: 1 }],
      reusedArtifactIds: ["ui-ir"],
      producedArtifactIds: ["code"],
      removedArtifactIds: ["legacy"],
    });

    expect(parsed.artifacts[0]?.version).toBe(1);
    expect(parsed.removedArtifactIds).toEqual(["legacy"]);
  });
});

describe("reconciliationReportSchema", () => {
  test("accepts a full report", () => {
    const parsed = reconciliationReportSchema.parse({
      executionId: "exec-2",
      added: 1,
      reused: 1,
      removed: 0,
      unchanged: 0,
    });

    expect(parsed.added).toBe(1);
  });

  test("rejects a negative count", () => {
    const result = reconciliationReportSchema.safeParse({
      executionId: "exec-2",
      added: -1,
      reused: 0,
      removed: 0,
      unchanged: 0,
    });

    expect(result.success).toBe(false);
  });

  test("rejects a fractional count", () => {
    const result = reconciliationReportSchema.safeParse({
      executionId: "exec-2",
      added: 1.5,
      reused: 0,
      removed: 0,
      unchanged: 0,
    });

    expect(result.success).toBe(false);
  });

  test("requires every counter", () => {
    for (const field of ["added", "reused", "removed", "unchanged"]) {
      const base: Record<string, unknown> = {
        executionId: "exec-2",
        added: 0,
        reused: 0,
        removed: 0,
        unchanged: 0,
      };
      delete base[field];

      expect(reconciliationReportSchema.safeParse(base).success).toBe(false);
    }
  });
});

describe("artifact reference version", () => {
  test("is optional so existing references keep parsing", () => {
    const parsed = artifactRefSchema.parse({ id: "ui-ir", type: "test" });

    expect(parsed.version).toBeUndefined();
  });

  test("is validated when supplied", () => {
    expect(
      artifactRefSchema.parse({ id: "ui-ir", type: "test", version: 3 }).version,
    ).toBe(3);

    expect(
      artifactRefSchema.safeParse({ id: "ui-ir", type: "test", version: 0 })
        .success,
    ).toBe(false);
  });
});

describe("execution event types", () => {
  test("include execution.reconciled", () => {
    expect(executionEventTypeSchema.parse("execution.reconciled")).toBe(
      "execution.reconciled",
    );
  });
});
