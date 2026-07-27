// packages/sdk/src/artifact-system.test.ts
import { describe, expect, test } from "bun:test";
import {
  artifactInputSchema,
  artifactLineageGraphSchema,
  artifactProvenanceSchema,
  artifactRelationSchema,
  artifactRelationTypeSchema,
  artifactSchema,
  artifactVersionSchema,
} from "./artifact-system";
import { executionEventTypeSchema } from "./execution-events";

describe("artifactSchema", () => {
  test("accepts a fully specified artifact", () => {
    const parsed = artifactSchema.parse({
      id: "ui-ir",
      type: "ui.ir",
      version: 1,
      createdAt: 1_700_000_000_000,
      metadata: { source: "figma" },
      provenance: {
        executionId: "exec-1",
        workflowId: "wf-1",
        capabilityId: "cap-1",
      },
    });

    expect(parsed.id).toBe("ui-ir");
    expect(parsed.version).toBe(1);
    expect(parsed.provenance?.capabilityId).toBe("cap-1");
  });

  test("defaults metadata and leaves provenance optional", () => {
    const parsed = artifactSchema.parse({
      id: "a",
      type: "t",
      version: 1,
      createdAt: 0,
    });

    expect(parsed.metadata).toEqual({});
    expect(parsed.provenance).toBeUndefined();
  });

  test("rejects a non-positive version", () => {
    const result = artifactSchema.safeParse({
      id: "a",
      type: "t",
      version: 0,
      createdAt: 0,
    });

    expect(result.success).toBe(false);
  });

  test("rejects a fractional version", () => {
    const result = artifactSchema.safeParse({
      id: "a",
      type: "t",
      version: 1.5,
      createdAt: 0,
    });

    expect(result.success).toBe(false);
  });

  test("rejects an empty id", () => {
    const result = artifactSchema.safeParse({
      id: "",
      type: "t",
      version: 1,
      createdAt: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactInputSchema", () => {
  test("allows the id to be omitted", () => {
    const parsed = artifactInputSchema.parse({ type: "ui.ir" });

    expect(parsed.id).toBeUndefined();
    expect(parsed.metadata).toEqual({});
  });

  test("rejects a missing type", () => {
    expect(artifactInputSchema.safeParse({}).success).toBe(false);
  });
});

describe("artifactProvenanceSchema", () => {
  test("requires execution and workflow identity", () => {
    expect(
      artifactProvenanceSchema.safeParse({ workflowId: "wf-1" }).success,
    ).toBe(false);
    expect(
      artifactProvenanceSchema.safeParse({ executionId: "exec-1" }).success,
    ).toBe(false);
  });

  test("treats capabilityId as optional", () => {
    const parsed = artifactProvenanceSchema.parse({
      executionId: "exec-1",
      workflowId: "wf-1",
    });

    expect(parsed.capabilityId).toBeUndefined();
  });
});

describe("artifactVersionSchema", () => {
  test("accepts a version record", () => {
    const parsed = artifactVersionSchema.parse({
      artifactId: "a",
      version: 2,
      hash: "abc123",
      createdAt: 5,
      metadata: { note: "second" },
    });

    expect(parsed.version).toBe(2);
    expect(parsed.hash).toBe("abc123");
  });

  test("rejects an empty hash", () => {
    const result = artifactVersionSchema.safeParse({
      artifactId: "a",
      version: 1,
      hash: "",
      createdAt: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactRelationSchema", () => {
  test("accepts every declared relation type", () => {
    for (const relation of artifactRelationTypeSchema.options) {
      const parsed = artifactRelationSchema.parse({
        sourceArtifactId: "a",
        targetArtifactId: "b",
        relation,
      });

      expect(parsed.relation).toBe(relation);
    }
  });

  test("rejects an unknown relation type", () => {
    const result = artifactRelationSchema.safeParse({
      sourceArtifactId: "a",
      targetArtifactId: "b",
      relation: "inspired_by",
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactLineageGraphSchema", () => {
  test("accepts an empty lineage graph", () => {
    const parsed = artifactLineageGraphSchema.parse({
      artifactId: "a",
      nodes: [],
      relations: [],
      ancestors: [],
      descendants: [],
    });

    expect(parsed.artifactId).toBe("a");
  });
});

describe("execution event types", () => {
  test("include the artifact lifecycle events", () => {
    expect(executionEventTypeSchema.parse("artifact.created")).toBe(
      "artifact.created",
    );
    expect(executionEventTypeSchema.parse("artifact.version_created")).toBe(
      "artifact.version_created",
    );
    expect(executionEventTypeSchema.parse("artifact.relation_added")).toBe(
      "artifact.relation_added",
    );
  });
});
