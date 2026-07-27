// packages/core/src/dag.test.ts
import { describe, expect, test } from "bun:test";
import { DagResolver } from "./dag";
import type { WorkflowDefinition } from "@designflow/sdk";
import { ExecutionError } from "./errors";

const makeDefinition = (
  id: string,
  nodes: WorkflowDefinition["nodes"],
): WorkflowDefinition => ({
  id,
  name: "test-workflow",
  description: "",
  nodes,
  metadata: {},
});

describe("DagResolver", () => {
  test("linear workflow produces layered plan A → B → C", () => {
    const definition = makeDefinition("wf-1", [
      { id: "A", capabilityId: "cap-a", inputMap: {} },
      { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
      { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["B"] } },
    ]);

    const resolver = new DagResolver();
    const plan = resolver.resolve(definition);

    expect(plan.workflowId).toBe("wf-1");
    expect(plan.totalSteps).toBe(3);
    expect(plan.layers).toHaveLength(3);
    expect(plan.layers[0].nodeIds).toEqual(["A"]);
    expect(plan.layers[1].nodeIds).toEqual(["B"]);
    expect(plan.layers[2].nodeIds).toEqual(["C"]);
  });

  test("branch workflow produces parallel layer A → {B, C}", () => {
    const definition = makeDefinition("wf-2", [
      { id: "A", capabilityId: "cap-a", inputMap: {} },
      { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
      { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["A"] } },
    ]);

    const resolver = new DagResolver();
    const plan = resolver.resolve(definition);

    expect(plan.layers).toHaveLength(2);
    expect(plan.layers[0].nodeIds).toEqual(["A"]);
    expect(plan.layers[1].nodeIds).toEqual(["B", "C"]);
  });

  test("merge workflow converges A,C → D", () => {
    const definition = makeDefinition("wf-3", [
      { id: "A", capabilityId: "cap-a", inputMap: {} },
      { id: "C", capabilityId: "cap-c", inputMap: {} },
      { id: "D", capabilityId: "cap-d", inputMap: {}, execution: { dependsOn: ["A", "C"] } },
    ]);

    const resolver = new DagResolver();
    const plan = resolver.resolve(definition);

    expect(plan.layers).toHaveLength(2);
    expect(plan.layers[0].nodeIds).toEqual(["A", "C"]);
    expect(plan.layers[1].nodeIds).toEqual(["D"]);
  });

  test("diamond workflow produces correct layers", () => {
    const definition = makeDefinition("wf-4", [
      { id: "A", capabilityId: "cap-a", inputMap: {} },
      { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
      { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["A"] } },
      { id: "D", capabilityId: "cap-d", inputMap: {}, execution: { dependsOn: ["B", "C"] } },
    ]);

    const resolver = new DagResolver();
    const plan = resolver.resolve(definition);

    expect(plan.layers).toHaveLength(3);
    expect(plan.layers[0].nodeIds).toEqual(["A"]);
    expect(plan.layers[1].nodeIds).toEqual(["B", "C"]);
    expect(plan.layers[2].nodeIds).toEqual(["D"]);
  });

  test("no dependency nodes all start in layer 0", () => {
    const definition = makeDefinition("wf-5", [
      { id: "A", capabilityId: "cap-a", inputMap: {} },
      { id: "B", capabilityId: "cap-b", inputMap: {} },
      { id: "C", capabilityId: "cap-c", inputMap: {} },
    ]);

    const resolver = new DagResolver();
    const plan = resolver.resolve(definition);

    expect(plan.layers).toHaveLength(1);
    expect(plan.layers[0].nodeIds).toEqual(["A", "B", "C"]);
  });

  test("detects cycle A → B → A with cycle nodes", () => {
    const definition = makeDefinition("wf-6", [
      { id: "A", capabilityId: "cap-a", inputMap: {}, execution: { dependsOn: ["B"] } },
      { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
    ]);

    const resolver = new DagResolver();
    let caught: unknown = null;
    try {
      resolver.resolve(definition);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ExecutionError);
    const err = caught as ExecutionError;
    expect(err.metadata.workflowId).toBe("wf-6");
    expect(err.metadata.cycleNodes).toBeDefined();
    expect((err.metadata.cycleNodes as string[]).length).toBeGreaterThanOrEqual(2);
  });

  test("detects self-referencing cycle", () => {
    const definition = makeDefinition("wf-7", [
      { id: "A", capabilityId: "cap-a", inputMap: {}, execution: { dependsOn: ["A"] } },
    ]);

    const resolver = new DagResolver();
    let caught: unknown = null;
    try {
      resolver.resolve(definition);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ExecutionError);
    const err = caught as ExecutionError;
    expect(err.metadata.cycleNodes).toEqual(["A"]);
  });

  test("steps are ordered by layer then workflow definition order", () => {
    const definition = makeDefinition("wf-8", [
      { id: "A", capabilityId: "cap-a", inputMap: {} },
      { id: "B", capabilityId: "cap-b", inputMap: {}, execution: { dependsOn: ["A"] } },
      { id: "C", capabilityId: "cap-c", inputMap: {}, execution: { dependsOn: ["A"] } },
      { id: "D", capabilityId: "cap-d", inputMap: {}, execution: { dependsOn: ["B", "C"] } },
    ]);

    const resolver = new DagResolver();
    const plan = resolver.resolve(definition);

    const stepIds = plan.steps.map((s) => s.nodeId);
    expect(stepIds).toEqual(["A", "B", "C", "D"]);
  });
});