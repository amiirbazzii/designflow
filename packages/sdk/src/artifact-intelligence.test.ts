// packages/sdk/src/artifact-intelligence.test.ts
import { describe, expect, test } from "bun:test";
import {
  artifactDependencySchema,
  artifactDiffSchema,
  artifactImpactSchema,
  artifactMetadataChangesSchema,
  artifactReuseCandidateSchema,
  artifactReuseReportSchema,
  artifactVersionRefSchema,
  capabilityReuseDecisionSchema,
} from "./artifact-intelligence";
import { executionEventTypeSchema } from "./execution-events";

describe("artifactDependencySchema", () => {
  test("accepts a dependency record", () => {
    const parsed = artifactDependencySchema.parse({
      artifactId: "validated-patch",
      dependencies: ["generated-code", "ui-ir", "figma-json"],
      dependents: [],
    });

    expect(parsed.dependencies).toHaveLength(3);
    expect(parsed.dependents).toEqual([]);
  });

  test("rejects a missing dependents array", () => {
    const result = artifactDependencySchema.safeParse({
      artifactId: "a",
      dependencies: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactImpactSchema", () => {
  test("accepts a full impact report", () => {
    const parsed = artifactImpactSchema.parse({
      artifactId: "ui-ir",
      affectedArtifacts: ["generated-code", "validated-patch"],
      affectedWorkflows: ["design-to-code"],
      affectedExecutions: ["exec-123"],
    });

    expect(parsed.affectedArtifacts).toHaveLength(2);
    expect(parsed.affectedWorkflows).toEqual(["design-to-code"]);
  });

  test("rejects an empty id inside an array", () => {
    const result = artifactImpactSchema.safeParse({
      artifactId: "a",
      affectedArtifacts: [""],
      affectedWorkflows: [],
      affectedExecutions: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactDiffSchema", () => {
  test("accepts a diff with metadata changes", () => {
    const parsed = artifactDiffSchema.parse({
      artifactId: "ui-ir",
      fromVersion: 1,
      toVersion: 2,
      changed: true,
      metadataChanges: {
        added: ["density"],
        removed: [],
        modified: ["components"],
      },
    });

    expect(parsed.changed).toBe(true);
    expect(parsed.metadataChanges?.modified).toEqual(["components"]);
  });

  test("treats metadataChanges as optional", () => {
    const parsed = artifactDiffSchema.parse({
      artifactId: "a",
      fromVersion: 1,
      toVersion: 2,
      changed: false,
    });

    expect(parsed.metadataChanges).toBeUndefined();
  });

  test("rejects a non-positive version", () => {
    const result = artifactDiffSchema.safeParse({
      artifactId: "a",
      fromVersion: 0,
      toVersion: 1,
      changed: false,
    });

    expect(result.success).toBe(false);
  });

  test("requires all three change buckets", () => {
    const result = artifactMetadataChangesSchema.safeParse({
      added: [],
      removed: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactVersionRefSchema", () => {
  test("treats version as optional", () => {
    const parsed = artifactVersionRefSchema.parse({ artifactId: "a" });

    expect(parsed.version).toBeUndefined();
  });

  test("rejects a fractional version", () => {
    const result = artifactVersionRefSchema.safeParse({
      artifactId: "a",
      version: 1.5,
    });

    expect(result.success).toBe(false);
  });
});

describe("artifactReuseReportSchema", () => {
  test("accepts a report", () => {
    const parsed = artifactReuseReportSchema.parse({
      candidates: [
        {
          artifactId: "a",
          currentVersion: 1,
          requestedVersion: 1,
          reusable: true,
          reason: "unchanged",
        },
      ],
      reusable: ["a"],
      allReusable: true,
    });

    expect(parsed.candidates[0]?.reason).toBe("unchanged");
  });

  test("rejects an unknown reuse reason", () => {
    const result = artifactReuseCandidateSchema.safeParse({
      artifactId: "a",
      reusable: false,
      reason: "stale",
    });

    expect(result.success).toBe(false);
  });
});

describe("capabilityReuseDecisionSchema", () => {
  test("defaults artifacts to an empty array", () => {
    const parsed = capabilityReuseDecisionSchema.parse({ reuse: false });

    expect(parsed.artifacts).toEqual([]);
  });

  test("validates adopted artifact references", () => {
    const parsed = capabilityReuseDecisionSchema.parse({
      reuse: true,
      artifacts: [{ id: "ui-ir", type: "ui.ir" }],
      reason: "cache hit",
    });

    expect(parsed.artifacts[0]?.id).toBe("ui-ir");
    expect(parsed.artifacts[0]?.metadata).toEqual({});
  });

  test("rejects a malformed artifact reference", () => {
    const result = capabilityReuseDecisionSchema.safeParse({
      reuse: true,
      artifacts: [{ type: "ui.ir" }],
    });

    expect(result.success).toBe(false);
  });
});

describe("execution event types", () => {
  test("include the intelligence events", () => {
    for (const type of [
      "artifact.impact_analyzed",
      "artifact.diff_created",
      "artifact.reused",
    ]) {
      expect(executionEventTypeSchema.parse(type)).toBe(type);
    }
  });
});
