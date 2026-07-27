// apps/cli/src/workflows/registry.test.ts
import { describe, expect, test } from "bun:test";
import { WorkflowRegistry } from "./registry";
import type { WorkflowPackage } from "@designflow/sdk";

function createTestPackage(id: string): WorkflowPackage {
  return {
    id,
    name: `Test Workflow ${id}`,
    version: "1.0.0",
    capabilities: [],
    definition: {
      id,
      name: `Test Workflow ${id}`,
      description: "",
      nodes: [],
      metadata: {},
    },
    load() {},
  };
}

describe("WorkflowRegistry", () => {
  test("registers valid package", () => {
    const registry = new WorkflowRegistry();
    const pkg = createTestPackage("workflow-1");
    registry.register(pkg);
    expect(registry.get("workflow-1")).toBeDefined();
  });

  test("rejects duplicate workflow id", () => {
    const registry = new WorkflowRegistry();
    const pkg1 = createTestPackage("workflow-1");
    const pkg2 = createTestPackage("workflow-1");
    registry.register(pkg1);
    expect(() => registry.register(pkg2)).toThrow("Duplicate workflow ID");
  });

  test("rejects invalid package", () => {
    const registry = new WorkflowRegistry();
    const invalidPkg = {
      id: "test",
      // missing name, version, and definition
    };
    expect(() => registry.register(invalidPkg as never)).toThrow();
  });

  test("lists registered workflows", () => {
    const registry = new WorkflowRegistry();
    registry.register(createTestPackage("workflow-1"));
    registry.register(createTestPackage("workflow-2"));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id)).toContain("workflow-1");
    expect(list.map((p) => p.id)).toContain("workflow-2");
  });

  test("returns undefined for unknown workflow", () => {
    const registry = new WorkflowRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });
});
