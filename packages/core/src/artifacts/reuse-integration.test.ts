import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
  Capability,
  CapabilityReuseDecision,
  CapabilityReuseRequest,
  CapabilityReuseResolver,
  ExecutionContext,
  ExecutionEvent,
  ExecutionRecord,
  Logger,
} from "@designflow/sdk";
import { ExecutionEngine } from "../engine";
import { CapabilityRegistry } from "../registry";
import { InMemoryExecutionRepository } from "../repository";
import { InMemoryEventPublisher } from "../events";
import { InMemoryArtifactStore } from "./in-memory-artifact-store";

// ── Helpers ─────────────────────────────────────────────────────

const createLogger = (): Logger => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

/** Records every request it is asked about, and answers from a script. */
class ScriptedReuseResolver implements CapabilityReuseResolver {
  public readonly requests: CapabilityReuseRequest[] = [];

  private readonly decide: (
    request: CapabilityReuseRequest,
  ) => CapabilityReuseDecision;

  public constructor(
    decide: (request: CapabilityReuseRequest) => CapabilityReuseDecision,
  ) {
    this.decide = decide;
  }

  public async resolve(
    request: CapabilityReuseRequest,
  ): Promise<CapabilityReuseDecision> {
    this.requests.push(request);
    return this.decide(request);
  }
}

interface Harness {
  readonly engine: ExecutionEngine;
  readonly registry: CapabilityRegistry;
  readonly artifactStore: InMemoryArtifactStore;
  readonly repository: InMemoryExecutionRepository;
  readonly events: ExecutionEvent[];
}

const createHarness = (resolver?: CapabilityReuseResolver): Harness => {
  const events: ExecutionEvent[] = [];
  const eventPublisher = new InMemoryEventPublisher();
  eventPublisher.subscribe((event) => {
    events.push(event);
  });

  const artifactStore = new InMemoryArtifactStore({ eventPublisher });
  const repository = new InMemoryExecutionRepository();
  const registry = new CapabilityRegistry();

  const engine = new ExecutionEngine(
    registry,
    createLogger(),
    artifactStore,
    repository,
    eventPublisher,
    undefined,
    resolver,
  );

  return { engine, registry, artifactStore, repository, events };
};

const createContext = (
  executionId: string,
  workflowId: string,
): ExecutionContext => ({
  runId: executionId,
  workflowId,
  stateRef: "test",
  artifacts: [],
  metadata: {},
  signal: new AbortController().signal,
});

const startExecution = async (
  repository: InMemoryExecutionRepository,
  executionId: string,
  workflowId: string,
): Promise<void> => {
  const record: ExecutionRecord = {
    executionId,
    workflowId,
    status: "running",
    startedAt: Date.now(),
  };
  await repository.create(record);
};

/** A capability that records each invocation so a skip is observable. */
const counting = (
  id: string,
  artifactId: string,
  calls: string[],
): Capability<unknown, unknown> => ({
  id,
  name: id,
  description: `Capability ${id}`,
  type: "pure",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => {
    calls.push(id);
    return { artifactRef: { id: artifactId, type: "ui.ir", metadata: {} } };
  },
});

const twoStep = {
  id: "wf-reuse",
  name: "reuse",
  description: "",
  nodes: [
    { id: "parse", capabilityId: "cap-parse", inputMap: { source: "figma" } },
    {
      id: "lower",
      capabilityId: "cap-lower",
      inputMap: {},
      execution: { dependsOn: ["parse"] },
    },
  ],
  metadata: {},
};

// ── 13. Capability skipped on reuse ─────────────────────────────

describe("capability reuse", () => {
  test("skips the capability body when the resolver approves reuse", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver((request) =>
      request.capabilityId === "cap-lower"
        ? {
            reuse: true,
            artifacts: [{ id: "ui-ir", type: "ui.ir", metadata: {} }],
            reason: "cache hit",
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);

    const result = await harness.engine.run(
      twoStep,
      createContext(executionId, twoStep.id),
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual(["cap-parse"]);

    // The node still completes and still contributes its artifacts.
    expect(result.completedSteps).toEqual(["parse", "lower"]);
    expect(result.artifacts.map((a) => a.id)).toEqual(["figma-json", "ui-ir"]);
  });

  test("executes normally when the resolver declines", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    expect(calls).toEqual(["cap-parse", "cap-lower"]);
  });

  test("executes normally when no resolver is configured", async () => {
    const calls: string[] = [];
    const harness = createHarness();
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    expect(calls).toEqual(["cap-parse", "cap-lower"]);
  });

  test("a skipped node does not register a new artifact version", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver((request) =>
      request.capabilityId === "cap-lower"
        ? {
            reuse: true,
            artifacts: [{ id: "ui-ir", type: "ui.ir", metadata: {} }],
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    // Reuse adopts a prior artifact; it never claims to have produced one.
    expect(await harness.artifactStore.getArtifact("ui-ir")).toBeNull();
  });
});

// ── Decision boundary inputs ────────────────────────────────────

describe("reuse decision boundary", () => {
  test("is consulted for every capability node before it runs", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    expect(resolver.requests.map((r) => r.nodeId)).toEqual(["parse", "lower"]);
    expect(resolver.requests[0]?.executionId).toBe(executionId);
    expect(resolver.requests[0]?.workflowId).toBe("wf-reuse");
    expect(resolver.requests[0]?.capabilityId).toBe("cap-parse");
  });

  test("carries a content fingerprint of the node input", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    const parse = resolver.requests.find((r) => r.nodeId === "parse");
    const lower = resolver.requests.find((r) => r.nodeId === "lower");

    expect(parse?.inputFingerprint.length).toBe(64);
    // Different inputs must fingerprint differently, or nothing can be cached
    // safely.
    expect(parse?.inputFingerprint).not.toBe(lower?.inputFingerprint);
  });

  test("fingerprints identical input identically across executions", async () => {
    const fingerprints: string[] = [];

    for (let run = 0; run < 2; run++) {
      const calls: string[] = [];
      const resolver = new ScriptedReuseResolver(() => ({
        reuse: false,
        artifacts: [],
      }));

      const harness = createHarness(resolver);
      harness.registry.register(counting("cap-parse", "figma-json", calls));
      harness.registry.register(counting("cap-lower", "ui-ir", calls));

      const executionId = crypto.randomUUID();
      await startExecution(harness.repository, executionId, twoStep.id);
      await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

      const parse = resolver.requests.find((r) => r.nodeId === "parse");
      if (parse !== undefined) fingerprints.push(parse.inputFingerprint);
    }

    expect(fingerprints[0]).toBe(fingerprints[1] ?? "");
  });

  test("reports dependency artifacts at their current versions", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    const parse = resolver.requests.find((r) => r.nodeId === "parse");
    const lower = resolver.requests.find((r) => r.nodeId === "lower");

    expect(parse?.dependencies).toEqual([]);
    expect(lower?.dependencies).toEqual([
      { artifactId: "figma-json", version: 1 },
    ]);
  });
});

// ── 12. artifact.reused event ───────────────────────────────────

describe("artifact.reused event", () => {
  test("is emitted for each adopted artifact", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver((request) =>
      request.capabilityId === "cap-lower"
        ? {
            reuse: true,
            artifacts: [{ id: "ui-ir", type: "ui.ir", metadata: {} }],
            reason: "cache hit",
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    const reused = harness.events.filter(
      (event) => event.type === "artifact.reused",
    );

    expect(reused).toHaveLength(1);
    expect(reused[0]?.executionId).toBe(executionId);
    expect(reused[0]?.payload?.artifactId).toBe("ui-ir");
    expect(reused[0]?.payload?.executionId).toBe(executionId);
    expect(reused[0]?.payload?.nodeId).toBe("lower");
    expect(reused[0]?.payload?.reason).toBe("cache hit");
  });

  test("carries the registered version when the artifact is known", async () => {
    const calls: string[] = [];

    const resolver = new ScriptedReuseResolver((request) =>
      request.capabilityId === "cap-lower"
        ? {
            reuse: true,
            artifacts: [{ id: "figma-json", type: "figma.json", metadata: {} }],
          }
        : { reuse: false, artifacts: [] },
    );

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    const reused = harness.events.filter(
      (event) => event.type === "artifact.reused",
    );

    // figma-json was registered by the parse node earlier in this run.
    expect(reused[0]?.payload?.version).toBe(1);
  });

  test("emits nothing when the resolver declines", async () => {
    const calls: string[] = [];
    const resolver = new ScriptedReuseResolver(() => ({
      reuse: false,
      artifacts: [],
    }));

    const harness = createHarness(resolver);
    harness.registry.register(counting("cap-parse", "figma-json", calls));
    harness.registry.register(counting("cap-lower", "ui-ir", calls));

    const executionId = crypto.randomUUID();
    await startExecution(harness.repository, executionId, twoStep.id);
    await harness.engine.run(twoStep, createContext(executionId, twoStep.id));

    expect(
      harness.events.filter((event) => event.type === "artifact.reused"),
    ).toHaveLength(0);
  });
});
