import { describe, expect, test } from "bun:test";
import {
  workflowInvocationSchema,
  workflowInvocationResultSchema,
  workflowInvocationContextSchema,
  childExecutionRequestSchema,
  executionLineageSchema,
  readExecutionLineage,
  withExecutionLineage,
  EXECUTION_LINEAGE_METADATA_KEY,
} from "./workflow-composition";
import {
  workflowStepNodeSchema,
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
