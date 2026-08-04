import { describe, expect, test } from "bun:test";
import { CapabilityRegistry } from "@designflow/core";
import {
  designToCodeFigmaSpecificationWorkflowPackage,
  designToCodeImplementationWorkflowPackage,
  sharedFigmaSpecificationCapabilities,
  visualValidationCapabilities,
  feedbackLoopCapabilities,
} from "@designflow/workflow-design-to-code";
import { registerExperimentalDesignToCodeWorkflows } from "./services/cli-runner";

function compose(flags: { figmaMcpEnabled: boolean; implementationEnabled: boolean }) {
  const registry = new CapabilityRegistry();
  const workflows = new Map<string, { id: string }>();
  registerExperimentalDesignToCodeWorkflows({
    registry,
    workflows: workflows as never,
    ...flags,
  });
  return { registry, workflows };
}

describe("experimental workflow composition", () => {
  test("Stage 3 alone starts and registers its workflow", () => {
    const { registry, workflows } = compose({ figmaMcpEnabled: true, implementationEnabled: false });
    expect(workflows.has(designToCodeFigmaSpecificationWorkflowPackage.id)).toBe(true);
    expect(registry.list()).toHaveLength(sharedFigmaSpecificationCapabilities.length + 1);
  });

  test("Stage 4 alone enables the shared Figma path", () => {
    const { registry, workflows } = compose({ figmaMcpEnabled: true, implementationEnabled: true });
    expect(workflows.has(designToCodeImplementationWorkflowPackage.id)).toBe(true);
    expect(registry.list()).toHaveLength(15 + visualValidationCapabilities.length + feedbackLoopCapabilities.length);
  });

  test("both stages start and shared Figma capabilities register exactly once", () => {
    const { registry, workflows } = compose({ figmaMcpEnabled: true, implementationEnabled: true });
    expect(workflows.has(designToCodeFigmaSpecificationWorkflowPackage.id)).toBe(true);
    expect(workflows.has(designToCodeImplementationWorkflowPackage.id)).toBe(true);
    for (const capability of sharedFigmaSpecificationCapabilities) {
      expect(registry.get(capability.id)).toBe(capability);
    }
    expect(new Set(registry.list().map((capability) => capability.id)).size).toBe(registry.list().length);
  });

  test("unrelated duplicate IDs remain rejected", () => {
    const registry = new CapabilityRegistry();
    const capability = sharedFigmaSpecificationCapabilities[0]!;
    registry.register(capability);
    expect(() => registry.register({ ...capability })).toThrow("Duplicate capability ID");
  });
});
