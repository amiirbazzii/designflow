import { describe, expect, test } from "bun:test";
import {
  CHANGED_ARTIFACTS_METADATA_KEY,
  executionPlanningRequestSchema,
  executionPlanningResultSchema,
  incrementalExecutionPlanSchema,
  nodeImpactSchema,
  readChangedArtifacts,
  withChangedArtifacts,
  workflowGraphNodeSchema,
  workflowGraphSchema,
} from "./execution-plan";
import { executionEventTypeSchema } from "./execution-events";
import { capabilityNodeSchema } from "./schemas";

describe("nodeImpactSchema", () => {
  test("accepts every declared reason", () => {
    for (const reason of [
      "artifact_changed",
      "dependency_changed",
      "unaffected",
    ]) {
      const parsed = nodeImpactSchema.parse({
        nodeId: "transform",
        affected: reason !== "unaffected",
        reason,
      });

      expect(parsed.reason).toBe(reason);
    }
  });

  test("rejects an unknown reason", () => {
    const result = nodeImpactSchema.safeParse({
      nodeId: "a",
      affected: true,
      reason: "maybe",
    });

    expect(result.success).toBe(false);
  });
});

describe("incrementalExecutionPlanSchema", () => {
  test("accepts a full plan", () => {
    const parsed = incrementalExecutionPlanSchema.parse({
      workflowId: "design-to-code",
      changedArtifacts: ["ui-ir"],
      affectedNodes: ["transform", "generate", "validate"],
      reusableNodes: ["parse"],
      executionNodes: ["transform", "generate", "validate"],
      skippedNodes: ["parse"],
    });

    expect(parsed.executionNodes).toHaveLength(3);
    expect(parsed.skippedNodes).toEqual(["parse"]);
  });

  test("requires every classification array", () => {
    const result = incrementalExecutionPlanSchema.safeParse({
      workflowId: "a",
      changedArtifacts: [],
      affectedNodes: [],
    });

    expect(result.success).toBe(false);
  });
});

describe("executionPlanningRequestSchema", () => {
  test("defaults changedArtifacts to an empty set", () => {
    const parsed = executionPlanningRequestSchema.parse({ workflowId: "a" });

    expect(parsed.changedArtifacts).toEqual([]);
    expect(parsed.previousExecutionId).toBeUndefined();
  });

  test("rejects an empty workflow id", () => {
    expect(
      executionPlanningRequestSchema.safeParse({ workflowId: "" }).success,
    ).toBe(false);
  });
});

describe("executionPlanningResultSchema", () => {
  test("accepts a plan with its node impacts", () => {
    const parsed = executionPlanningResultSchema.parse({
      plan: {
        workflowId: "a",
        changedArtifacts: [],
        affectedNodes: [],
        reusableNodes: [],
        executionNodes: ["parse"],
        skippedNodes: [],
      },
      nodeImpacts: [
        { nodeId: "parse", affected: false, reason: "unaffected" },
      ],
    });

    expect(parsed.nodeImpacts).toHaveLength(1);
  });
});

describe("workflowGraphSchema", () => {
  test("defaults dependencies and produces", () => {
    const parsed = workflowGraphNodeSchema.parse({ id: "parse" });

    expect(parsed.dependencies).toEqual([]);
    expect(parsed.produces).toEqual([]);
  });

  test("accepts a chain", () => {
    const parsed = workflowGraphSchema.parse({
      workflowId: "design-to-code",
      nodes: [
        { id: "parse", dependencies: [], produces: ["figma-json"] },
        { id: "transform", dependencies: ["parse"], produces: ["ui-ir"] },
      ],
    });

    expect(parsed.nodes[1]?.dependencies).toEqual(["parse"]);
  });
});

describe("node produces declaration", () => {
  test("is optional so existing nodes keep parsing", () => {
    const parsed = capabilityNodeSchema.parse({
      id: "parse",
      capabilityId: "cap-parse",
    });

    expect(parsed.produces).toBeUndefined();
  });

  test("is validated when supplied", () => {
    const parsed = capabilityNodeSchema.parse({
      id: "parse",
      capabilityId: "cap-parse",
      produces: ["figma-json"],
    });

    expect(parsed.produces).toEqual(["figma-json"]);

    expect(
      capabilityNodeSchema.safeParse({
        id: "parse",
        capabilityId: "cap-parse",
        produces: [""],
      }).success,
    ).toBe(false);
  });
});

describe("changed artifacts metadata", () => {
  test("round-trips through metadata", () => {
    const metadata = withChangedArtifacts({ other: 1 }, ["ui-ir"]);

    expect(metadata[CHANGED_ARTIFACTS_METADATA_KEY]).toEqual(["ui-ir"]);
    expect(metadata.other).toBe(1);
    expect(readChangedArtifacts(metadata)).toEqual(["ui-ir"]);
  });

  test("an empty set removes the key so it is never inherited", () => {
    const seeded = withChangedArtifacts(undefined, ["ui-ir"]);
    const cleared = withChangedArtifacts(seeded, []);

    expect(CHANGED_ARTIFACTS_METADATA_KEY in cleared).toBe(false);
    expect(readChangedArtifacts(cleared)).toEqual([]);
  });

  test("reads an empty set from absent or malformed metadata", () => {
    expect(readChangedArtifacts(undefined)).toEqual([]);
    expect(readChangedArtifacts({})).toEqual([]);
    expect(
      readChangedArtifacts({ [CHANGED_ARTIFACTS_METADATA_KEY]: "ui-ir" }),
    ).toEqual([]);
    expect(
      readChangedArtifacts({ [CHANGED_ARTIFACTS_METADATA_KEY]: [1, 2] }),
    ).toEqual([]);
  });
});

describe("execution event types", () => {
  test("include execution.plan_created", () => {
    expect(executionEventTypeSchema.parse("execution.plan_created")).toBe(
      "execution.plan_created",
    );
  });
});
