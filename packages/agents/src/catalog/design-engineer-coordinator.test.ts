// packages/agents/src/catalog/design-engineer-coordinator.test.ts
import { describe, expect, test } from "bun:test";
import { createAgentRegistry } from "../index";
import {
  designEngineerAgentManifest,
  designEngineerDefaultModelProfile,
} from "./design-engineer-agent";
import {
  designEngineerCoordinatorManifest,
  designEngineerCoordinatorDefaultModelProfile,
} from "./design-engineer-coordinator";

describe("the coordinator and the retained alias", () => {
  test("both register under distinct ids in the built-in catalogue", () => {
    const registry = createAgentRegistry();
    expect(registry.get("design-engineer-agent")).toBeDefined();
    expect(registry.get("design-engineer-coordinator")).toBeDefined();
  });

  test("each has its own independent model profile", () => {
    expect(designEngineerAgentManifest.modelProfileId).toBe("design-engineer-default");
    expect(designEngineerCoordinatorManifest.modelProfileId).toBe(
      "design-engineer-coordinator-default",
    );
    expect(designEngineerAgentManifest.modelProfileId).not.toBe(
      designEngineerCoordinatorManifest.modelProfileId,
    );
  });

  test("the default profiles resolve to their own distinct ids", () => {
    expect(designEngineerDefaultModelProfile.id).toBe("design-engineer-default");
    expect(designEngineerCoordinatorDefaultModelProfile.id).toBe(
      "design-engineer-coordinator-default",
    );
  });

  test("both share the same allowed workflow, since the coordinator is the alias's replacement, not a different agent", () => {
    expect(designEngineerAgentManifest.allowedWorkflows).toEqual(
      designEngineerCoordinatorManifest.allowedWorkflows,
    );
  });

  test("a custom coordinator strategy does not affect the retained alias", async () => {
    const registry = createAgentRegistry({
      designEngineerCoordinatorStrategy: async () => ({
        type: "decline",
        reason: "custom",
      }),
    });

    const coordinatorDecision = await registry
      .require("design-engineer-coordinator")
      .decide(
        { workerId: "design-engineer", agentId: "design-engineer-coordinator", request: "build x" },
        {
          availableWorkflows: ["design-to-code"],
          availableTools: [],
          tools: { call: async () => ({ type: "failure", callId: "1", toolId: "x", code: "ERR", message: "no", retryable: false, durationMs: 0 }) },
          model: { generate: async () => ({ type: "failure", requestId: "1", code: "ERR_MODEL_PROFILE_NOT_FOUND", message: "no", retryable: false, durationMs: 0 }) },
          metadata: {},
          signal: new AbortController().signal,
          logger: { info() {}, warn() {}, error() {}, debug() {} },
        },
      );

    expect(coordinatorDecision.type).toBe("decline");

    const aliasDecision = await registry
      .require("design-engineer-agent")
      .decide(
        { workerId: "design-engineer", agentId: "design-engineer-agent", request: "" },
        {
          availableWorkflows: ["design-to-code"],
          availableTools: [],
          tools: { call: async () => ({ type: "failure", callId: "1", toolId: "x", code: "ERR", message: "no", retryable: false, durationMs: 0 }) },
          model: { generate: async () => ({ type: "failure", requestId: "1", code: "ERR_MODEL_PROFILE_NOT_FOUND", message: "no", retryable: false, durationMs: 0 }) },
          metadata: {},
          signal: new AbortController().signal,
          logger: { info() {}, warn() {}, error() {}, debug() {} },
        },
      );

    // The alias's deterministic default asks a clarifying question for an
    // empty request — unaffected by the coordinator's custom strategy above.
    expect(aliasDecision.type).toBe("request_clarification");
  });
});
