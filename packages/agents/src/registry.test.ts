// packages/agents/src/registry.test.ts
import { describe, expect, test } from "bun:test";
import {
  DesignFlowError,
  workerManifestSchema,
  type Agent,
  type AgentDecision,
  type AgentManifest,
} from "@designflow/sdk";

import { InMemoryAgentRegistry, assertWorkerAgentAlignment } from "./registry";
import {
  BUILT_IN_AGENTS,
  createAgentRegistry,
  designEngineerAgent,
  designEngineerAgentManifest,
} from "./index";

/**
 * The agent catalogue.
 *
 * Registration, resolution and the one consistency check that runs when a
 * worker is wired to an agent. Nothing here decides anything — that boundary
 * is the subject of `runtime.test.ts`.
 */

function agent(overrides: Partial<AgentManifest> = {}): Agent {
  const manifest: AgentManifest = {
    id: "test-agent",
    name: "Test Agent",
    description: "Decides things in tests",
    version: "1.0.0",
    instructions: "Run alpha.",
    allowedWorkflows: ["alpha"],
    ...overrides,
  };

  return {
    manifest,
    decide: (): Promise<AgentDecision> =>
      Promise.resolve({ type: "run_workflow", workflowId: "alpha" }),
  };
}

// ── Registration ────────────────────────────────────────────────

describe("registering an agent", () => {
  test("validates the manifest at the boundary", () => {
    const registry = new InMemoryAgentRegistry();

    expect(() => registry.register(agent({ allowedWorkflows: [] }))).toThrow();
    expect(() => registry.register(agent({ id: "" }))).toThrow();
  });

  test("refuses a duplicate id rather than overwriting", () => {
    const registry = new InMemoryAgentRegistry([agent()]);

    // Two agents answering to one name means a worker's `agentId` resolves to
    // whichever registered last — an allow-list silently replaced.
    expect(() => registry.register(agent())).toThrow(DesignFlowError);
  });

  test("names the duplicate with a stable code", () => {
    const registry = new InMemoryAgentRegistry([agent()]);

    try {
      registry.register(agent());
      throw new Error("expected a duplicate registration to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_AGENT_ALREADY_REGISTERED");
      expect((error as DesignFlowError).metadata.agentId).toBe("test-agent");
    }
  });

  test("a duplicate does not replace the agent already registered", () => {
    const first = agent();
    const registry = new InMemoryAgentRegistry([first]);

    expect(() => registry.register(agent({ allowedWorkflows: ["beta"] }))).toThrow();
    expect(registry.require("test-agent").manifest.allowedWorkflows).toEqual(["alpha"]);
  });

  test("two different agents coexist", () => {
    const registry = new InMemoryAgentRegistry([agent(), agent({ id: "other" })]);

    expect(registry.list().map((manifest) => manifest.id)).toEqual([
      "test-agent",
      "other",
    ]);
  });
});

// ── Resolution ──────────────────────────────────────────────────

describe("resolving an agent", () => {
  test("finds a registered agent by id", () => {
    const registry = new InMemoryAgentRegistry([agent()]);

    expect(registry.get("test-agent")?.manifest.name).toBe("Test Agent");
  });

  test("returns undefined for an unknown id", () => {
    expect(new InMemoryAgentRegistry().get("nobody")).toBeUndefined();
  });

  test("require names what went wrong and what was available", () => {
    const registry = new InMemoryAgentRegistry([agent()]);

    try {
      registry.require("nobody");
      throw new Error("expected an unknown agent to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_AGENT_NOT_FOUND");
      expect((error as DesignFlowError).metadata.available).toEqual(["test-agent"]);
    }
  });
});

// ── Listing ─────────────────────────────────────────────────────

describe("listing agents", () => {
  test("preserves registration order", () => {
    const registry = new InMemoryAgentRegistry([
      agent({ id: "first" }),
      agent({ id: "second" }),
      agent({ id: "third" }),
    ]);

    expect(registry.list().map((manifest) => manifest.id)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  test("returns manifests, not invocable agents", () => {
    const registry = new InMemoryAgentRegistry([agent()]);
    const [listed] = registry.list();

    // Listing is for showing what is installed. Handing out the objects with
    // `decide` on them would make the catalogue a way to invoke one.
    expect(listed).not.toHaveProperty("decide");
    expect(listed?.id).toBe("test-agent");
  });

  test("is empty for a fresh registry", () => {
    expect(new InMemoryAgentRegistry().list()).toEqual([]);
  });
});

// ── The shipped catalogue ───────────────────────────────────────

describe("the built-in catalogue", () => {
  test("ships the Design Engineer agent", () => {
    expect(createAgentRegistry().get("design-engineer-agent")).toBeDefined();
    expect(BUILT_IN_AGENTS).toContain(designEngineerAgent);
  });

  test("its manifest is valid and permits only design-to-code", () => {
    expect(designEngineerAgentManifest.allowedWorkflows).toEqual(["design-to-code", "design-to-code-implementation", "design-to-code-figma-specification"]);
    // One tool, named explicitly. No wildcard exists to grant more.
    expect(designEngineerAgentManifest.allowedTools).toEqual(["classify-design-task"]);
    expect(designEngineerAgentManifest.version).toBe("0.3.0");
  });

  test("a fresh registry per call, so hosts cannot leak agents into each other", () => {
    const first = createAgentRegistry();
    first.register(agent({ id: "host-specific" }));

    expect(createAgentRegistry().get("host-specific")).toBeUndefined();
  });
});

// ── Worker/agent alignment ──────────────────────────────────────

describe("assertWorkerAgentAlignment", () => {
  const worker = (workflows: readonly string[]) =>
    workerManifestSchema.parse({
      id: "w",
      name: "W",
      description: "d",
      category: "c",
      workflows,
      agentId: "test-agent",
    });

  test("passes when the worker promises only what the agent may run", () => {
    expect(() =>
      assertWorkerAgentAlignment(worker(["alpha"]), agent().manifest),
    ).not.toThrow();
  });

  test("refuses a worker advertising work its agent may never choose", () => {
    try {
      assertWorkerAgentAlignment(worker(["alpha", "beta"]), agent().manifest);
      throw new Error("expected a misaligned worker to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_AGENT_WORKFLOW_NOT_ALLOWED");
      expect((error as DesignFlowError).metadata.workflowId).toBe("beta");
    }
  });

  test("the shipped worker/agent pair is aligned", () => {
    expect(() =>
      assertWorkerAgentAlignment(
        workerManifestSchema.parse({
          id: "design-engineer",
          name: "Design Engineer",
          description: "d",
          category: "development",
          workflows: ["design-to-code"],
          agentId: "design-engineer-agent",
        }),
        designEngineerAgentManifest,
      ),
    ).not.toThrow();
  });
});
