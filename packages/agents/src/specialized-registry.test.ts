// packages/agents/src/specialized-registry.test.ts
import { describe, expect, test } from "bun:test";
import type { AgentManifest, SpecializedAgent } from "@designflow/sdk";
import { InMemorySpecializedAgentRegistry } from "./specialized-registry";
import { AgentNotFoundError, DuplicateAgentError } from "./errors";

function agent(overrides: Partial<AgentManifest> = {}): SpecializedAgent {
  const manifest: AgentManifest = {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    version: "1.0.0",
    instructions: "Do the thing.",
    allowedWorkflows: ["some-workflow"],
    allowedTools: [],
    ...overrides,
  };

  return {
    manifest,
    perform: async () => ({ ok: true }),
  };
}

describe("registering a specialized agent", () => {
  test("registers and resolves by id", () => {
    const registry = new InMemorySpecializedAgentRegistry([agent()]);
    expect(registry.get("test-agent")?.manifest.id).toBe("test-agent");
  });

  test("rejects a duplicate id", () => {
    const registry = new InMemorySpecializedAgentRegistry([agent()]);
    expect(() => registry.register(agent())).toThrow(DuplicateAgentError);
  });

  test("two agents with different ids both register", () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agent({ id: "a" }),
      agent({ id: "b" }),
    ]);
    expect(registry.list().map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
});

describe("resolving a specialized agent", () => {
  test("require throws with the available ids when missing", () => {
    const registry = new InMemorySpecializedAgentRegistry([agent({ id: "a" })]);
    expect(() => registry.require("missing")).toThrow(AgentNotFoundError);
  });

  test("get returns undefined for an unregistered id", () => {
    const registry = new InMemorySpecializedAgentRegistry();
    expect(registry.get("nope")).toBeUndefined();
  });
});

describe("listing specialized agents", () => {
  test("never exposes the perform callback", () => {
    const registry = new InMemorySpecializedAgentRegistry([agent()]);
    const listed = registry.list()[0] as unknown as Record<string, unknown>;
    expect(listed?.perform).toBeUndefined();
  });

  test("each agent keeps its own independent version", () => {
    const registry = new InMemorySpecializedAgentRegistry([
      agent({ id: "a", version: "0.1.0" }),
      agent({ id: "b", version: "0.2.0" }),
    ]);
    expect(registry.require("a").manifest.version).toBe("0.1.0");
    expect(registry.require("b").manifest.version).toBe("0.2.0");
  });
});
