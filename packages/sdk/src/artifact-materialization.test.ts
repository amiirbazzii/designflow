// packages/sdk/src/artifact-materialization.test.ts
import { describe, expect, test } from "bun:test";
import {
  artifactMaterializationRequestSchema,
  artifactMaterializationResultSchema,
} from "./artifact-materialization";
import { executionEventTypeSchema } from "./execution-events";

describe("artifactMaterializationRequestSchema", () => {
  test("accepts a full request", () => {
    const parsed = artifactMaterializationRequestSchema.parse({
      nodeId: "parse",
      capabilityId: "cap-parse",
      executionId: "exec-1",
      artifactIds: ["figma-json"],
    });

    expect(parsed.artifactIds).toEqual(["figma-json"]);
  });

  test("accepts an empty artifact list", () => {
    const parsed = artifactMaterializationRequestSchema.parse({
      nodeId: "parse",
      capabilityId: "cap-parse",
      executionId: "exec-1",
      artifactIds: [],
    });

    expect(parsed.artifactIds).toEqual([]);
  });

  test("requires every identity field", () => {
    for (const field of ["nodeId", "capabilityId", "executionId"]) {
      const base: Record<string, unknown> = {
        nodeId: "parse",
        capabilityId: "cap-parse",
        executionId: "exec-1",
        artifactIds: [],
      };
      delete base[field];

      expect(artifactMaterializationRequestSchema.safeParse(base).success).toBe(
        false,
      );
    }
  });

  test("rejects an empty artifact id", () => {
    const result = artifactMaterializationRequestSchema.safeParse({
      nodeId: "parse",
      capabilityId: "cap-parse",
      executionId: "exec-1",
      artifactIds: [""],
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactMaterializationResultSchema", () => {
  test("defaults artifacts to an empty array", () => {
    const parsed = artifactMaterializationResultSchema.parse({
      success: false,
    });

    expect(parsed.artifacts).toEqual([]);
    expect(parsed.sourceExecutionId).toBeUndefined();
  });

  test("validates each artifact reference", () => {
    const parsed = artifactMaterializationResultSchema.parse({
      success: true,
      artifacts: [{ id: "figma-json", type: "figma.json" }],
      sourceExecutionId: "exec-previous",
    });

    expect(parsed.artifacts[0]?.metadata).toEqual({});
    expect(parsed.sourceExecutionId).toBe("exec-previous");
  });

  test("rejects a malformed artifact reference", () => {
    const result = artifactMaterializationResultSchema.safeParse({
      success: true,
      artifacts: [{ type: "figma.json" }],
    });

    expect(result.success).toBe(false);
  });

  test("rejects an empty sourceExecutionId", () => {
    const result = artifactMaterializationResultSchema.safeParse({
      success: true,
      artifacts: [],
      sourceExecutionId: "",
    });

    expect(result.success).toBe(false);
  });
});

describe("execution event types", () => {
  test("include artifact.materialized", () => {
    expect(executionEventTypeSchema.parse("artifact.materialized")).toBe(
      "artifact.materialized",
    );
  });
});
