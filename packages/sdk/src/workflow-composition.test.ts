// packages/sdk/src/workflow-composition.test.ts
import { describe, expect, test } from "bun:test";
import {
  workflowInvocationSchema,
  workflowInvocationResultSchema,
  workflowInvocationContextSchema,
  childExecutionRequestSchema,
  executionLineageSchema,
  readExecutionLineage,
  withExecutionLineage,
  readExecutionInput,
  withExecutionInput,
  compositionCheckpointSchema,
  readCompositionCheckpoint,
  withCompositionCheckpoint,
  EXECUTION_LINEAGE_METADATA_KEY,
  EXECUTION_INPUT_METADATA_KEY,
} from "./workflow-composition";
import { policyViolationSchema } from "./execution-policy";
import {
  workflowStepNodeSchema,
  workflowInputRefSchema,
  workflowDefinitionSchema,
  isCapabilityNode,
  isWorkflowNode,
} from "./schemas";
import { executionEventTypeSchema } from "./execution-events";

describe("workflowInvocationSchema", () => {
  test("accepts a minimal invocation", () => {
    const parsed = workflowInvocationSchema.parse({ workflowId: "wf-child" });
    expect(parsed.workflowId).toBe("wf-child");
    expect(parsed.input).toBeUndefined();
  });

  test("accepts input and metadata", () => {
    const parsed = workflowInvocationSchema.parse({
      workflowId: "wf-child",
      input: { seed: 1 },
      metadata: { origin: "parent" },
    });
    expect(parsed.input).toEqual({ seed: 1 });
    expect(parsed.metadata).toEqual({ origin: "parent" });
  });

  test("rejects an empty workflowId", () => {
    expect(() => workflowInvocationSchema.parse({ workflowId: "" })).toThrow();
  });
});

describe("workflowInvocationResultSchema", () => {
  test("accepts every terminal status", () => {
    for (const status of [
      "completed",
      "failed",
      "cancelled",
      "pending_approval",
    ] as const) {
      const parsed = workflowInvocationResultSchema.parse({
        executionId: "exec-1",
        workflowId: "wf-child",
        status,
        artifacts: [],
      });
      expect(parsed.status).toBe(status);
    }
  });

  test("applies artifact metadata defaults", () => {
    const parsed = workflowInvocationResultSchema.parse({
      executionId: "exec-1",
      workflowId: "wf-child",
      status: "completed",
      artifacts: [{ id: "a-1", type: "test" }],
    });
    expect(parsed.artifacts[0]?.metadata).toEqual({});
  });

  test("rejects an unknown status", () => {
    expect(() =>
      workflowInvocationResultSchema.parse({
        executionId: "exec-1",
        workflowId: "wf-child",
        status: "running",
        artifacts: [],
      }),
    ).toThrow();
  });

  test("accepts a normalized error", () => {
    const parsed = workflowInvocationResultSchema.parse({
      executionId: "exec-1",
      workflowId: "wf-child",
      status: "failed",
      artifacts: [],
      error: { code: "ERR_X", message: "boom" },
    });
    expect(parsed.error?.code).toBe("ERR_X");
  });
});

describe("workflowInvocationContextSchema", () => {
  test("requires full parent identity", () => {
    const parsed = workflowInvocationContextSchema.parse({
      parentExecutionId: "exec-parent",
      parentWorkflowId: "wf-parent",
      parentNodeId: "node-1",
    });
    expect(parsed.parentNodeId).toBe("node-1");
  });

  test("rejects a missing parentNodeId", () => {
    expect(() =>
      workflowInvocationContextSchema.parse({
        parentExecutionId: "exec-parent",
        parentWorkflowId: "wf-parent",
      }),
    ).toThrow();
  });
});

describe("childExecutionRequestSchema", () => {
  test("defaults the composition path", () => {
    const parsed = childExecutionRequestSchema.parse({
      workflowId: "wf-child",
      lineage: {
        parentExecutionId: "exec-parent",
        parentWorkflowId: "wf-parent",
        parentNodeId: "node-1",
      },
    });
    expect(parsed.lineage.compositionPath).toEqual([]);
  });

  test("rejects a request without lineage", () => {
    expect(() =>
      childExecutionRequestSchema.parse({ workflowId: "wf-child" }),
    ).toThrow();
  });
});

describe("execution lineage helpers", () => {
  test("readExecutionLineage returns an empty lineage for a root execution", () => {
    expect(readExecutionLineage(undefined)).toEqual({ compositionPath: [] });
    expect(readExecutionLineage({})).toEqual({ compositionPath: [] });
  });

  test("readExecutionLineage ignores malformed lineage", () => {
    expect(readExecutionLineage({ lineage: "nope" })).toEqual({
      compositionPath: [],
    });
  });

  test("withExecutionLineage round-trips through readExecutionLineage", () => {
    const metadata = withExecutionLineage(
      { environment: "test" },
      {
        parentExecutionId: "exec-parent",
        parentWorkflowId: "wf-parent",
        parentNodeId: "node-1",
        compositionPath: ["wf-parent"],
      },
    );

    expect(metadata.environment).toBe("test");
    expect(metadata[EXECUTION_LINEAGE_METADATA_KEY]).toBeDefined();

    const lineage = readExecutionLineage(metadata);
    expect(lineage.parentExecutionId).toBe("exec-parent");
    expect(lineage.parentWorkflowId).toBe("wf-parent");
    expect(lineage.parentNodeId).toBe("node-1");
    expect(lineage.compositionPath).toEqual(["wf-parent"]);
  });

  test("executionLineageSchema allows a partial lineage", () => {
    const parsed = executionLineageSchema.parse({ compositionPath: ["a"] });
    expect(parsed.parentExecutionId).toBeUndefined();
    expect(parsed.compositionPath).toEqual(["a"]);
  });
});

describe("execution input helpers", () => {
  test("withExecutionInput stores and readExecutionInput recovers", () => {
    const metadata = withExecutionInput({ environment: "test" }, { seed: 1 });
    expect(metadata.environment).toBe("test");
    expect(readExecutionInput(metadata)).toEqual({ seed: 1 });
  });

  test("an undefined input removes an inherited key", () => {
    const inherited = withExecutionInput(undefined, { seed: 1 });
    const cleared = withExecutionInput(inherited, undefined);

    expect(readExecutionInput(cleared)).toBeUndefined();
    expect(EXECUTION_INPUT_METADATA_KEY in cleared).toBe(false);
  });

  test("readExecutionInput tolerates missing metadata", () => {
    expect(readExecutionInput(undefined)).toBeUndefined();
    expect(readExecutionInput({})).toBeUndefined();
  });

  test("falsy inputs are preserved", () => {
    expect(readExecutionInput(withExecutionInput(undefined, 0))).toBe(0);
    expect(readExecutionInput(withExecutionInput(undefined, false))).toBe(false);
    expect(readExecutionInput(withExecutionInput(undefined, null))).toBeNull();
  });
});

describe("compositionCheckpointSchema", () => {
  const base = {
    pendingNodeId: "child",
    childExecutionId: "exec-child",
    childWorkflowId: "wf-child",
    pendingNodes: [
      {
        nodeId: "child",
        childExecutionId: "exec-child",
        childWorkflowId: "wf-child",
      },
    ],
  };

  test("applies array defaults", () => {
    const parsed = compositionCheckpointSchema.parse(base);
    expect(parsed.completedNodeIds).toEqual([]);
    expect(parsed.completedArtifacts).toEqual([]);
    expect(parsed.childArtifacts).toEqual([]);
    expect(parsed.pendingNodes[0]?.childArtifacts).toEqual([]);
  });

  test("requires at least one pending node", () => {
    expect(() =>
      compositionCheckpointSchema.parse({ ...base, pendingNodes: [] }),
    ).toThrow();
  });

  test("requires a pending node id", () => {
    const { pendingNodeId: _omitted, ...withoutPending } = base;
    expect(() => compositionCheckpointSchema.parse(withoutPending)).toThrow();
  });

  test("round-trips through metadata", () => {
    const checkpoint = compositionCheckpointSchema.parse({
      ...base,
      completedNodeIds: ["a"],
      completedArtifacts: [{ id: "art-a", type: "test" }],
    });

    const metadata = withCompositionCheckpoint({ phase: "x" }, checkpoint);
    expect(metadata.phase).toBe("x");

    const restored = readCompositionCheckpoint(metadata);
    expect(restored?.completedNodeIds).toEqual(["a"]);
    expect(restored?.completedArtifacts[0]?.id).toBe("art-a");
    expect(restored?.pendingNodeId).toBe("child");
  });

  test("readCompositionCheckpoint returns null when absent or malformed", () => {
    expect(readCompositionCheckpoint(undefined)).toBeNull();
    expect(readCompositionCheckpoint({})).toBeNull();
    expect(readCompositionCheckpoint({ composition: "nope" })).toBeNull();
    expect(readCompositionCheckpoint({ composition: {} })).toBeNull();
  });
});

describe("policyViolationSchema", () => {
  test("requires a machine-readable type", () => {
    expect(() =>
      policyViolationSchema.parse({ ruleId: "r1", message: "denied" }),
    ).toThrow();
  });

  test("accepts each violation type", () => {
    for (const type of [
      "capability_denied",
      "capability_not_allowed",
      "approval_required",
    ] as const) {
      const parsed = policyViolationSchema.parse({
        ruleId: "r1",
        type,
        message: "m",
      });
      expect(parsed.type).toBe(type);
    }
  });

  test("rejects an unknown type", () => {
    expect(() =>
      policyViolationSchema.parse({
        ruleId: "r1",
        type: "something_else",
        message: "m",
      }),
    ).toThrow();
  });
});

describe("workflowInputRefSchema", () => {
  test("accepts the whole-input form", () => {
    expect(workflowInputRefSchema.parse({ $workflowInput: true })).toEqual({
      $workflowInput: true,
    });
  });

  test("accepts the property-selector form", () => {
    expect(workflowInputRefSchema.parse({ $workflowInput: "seed" })).toEqual({
      $workflowInput: "seed",
    });
  });

  test("is strict so ordinary objects are not mistaken for references", () => {
    expect(
      workflowInputRefSchema.safeParse({ $workflowInput: true, other: 1 })
        .success,
    ).toBe(false);
    expect(workflowInputRefSchema.safeParse({ seed: 1 }).success).toBe(false);
    expect(
      workflowInputRefSchema.safeParse({ $workflowInput: false }).success,
    ).toBe(false);
    expect(
      workflowInputRefSchema.safeParse({ $workflowInput: "" }).success,
    ).toBe(false);
  });
});

describe("workflowStepNodeSchema", () => {
  test("parses a legacy capability node without kind", () => {
    const parsed = workflowStepNodeSchema.parse({
      id: "node-1",
      capabilityId: "cap-a",
    });
    expect(isCapabilityNode(parsed)).toBe(true);
    expect(isWorkflowNode(parsed)).toBe(false);
    expect(parsed.inputMap).toEqual({});
  });

  test("parses an explicit capability node", () => {
    const parsed = workflowStepNodeSchema.parse({
      id: "node-1",
      kind: "capability",
      capabilityId: "cap-a",
    });
    expect(isCapabilityNode(parsed)).toBe(true);
  });

  test("parses a workflow node", () => {
    const parsed = workflowStepNodeSchema.parse({
      id: "node-1",
      kind: "workflow",
      workflowId: "wf-child",
      inputMap: { seed: 1 },
    });
    expect(isWorkflowNode(parsed)).toBe(true);
    if (isWorkflowNode(parsed)) {
      expect(parsed.workflowId).toBe("wf-child");
    }
  });

  test("rejects a workflow node without workflowId", () => {
    expect(() =>
      workflowStepNodeSchema.parse({ id: "node-1", kind: "workflow" }),
    ).toThrow();
  });

  test("rejects a capability node without capabilityId", () => {
    expect(() => workflowStepNodeSchema.parse({ id: "node-1" })).toThrow();
  });

  test("workflowDefinitionSchema accepts mixed node kinds", () => {
    const parsed = workflowDefinitionSchema.parse({
      id: "wf-parent",
      name: "parent",
      nodes: [
        { id: "a", capabilityId: "cap-a" },
        {
          id: "b",
          kind: "workflow",
          workflowId: "wf-child",
          execution: { dependsOn: ["a"] },
        },
      ],
    });

    expect(parsed.nodes).toHaveLength(2);
    expect(isCapabilityNode(parsed.nodes[0]!)).toBe(true);
    expect(isWorkflowNode(parsed.nodes[1]!)).toBe(true);
  });
});

describe("child workflow event types", () => {
  test("child lifecycle event types are registered", () => {
    expect(executionEventTypeSchema.parse("workflow.child_started")).toBe(
      "workflow.child_started",
    );
    expect(executionEventTypeSchema.parse("workflow.child_completed")).toBe(
      "workflow.child_completed",
    );
    expect(executionEventTypeSchema.parse("workflow.child_failed")).toBe(
      "workflow.child_failed",
    );
  });
});
