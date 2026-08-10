// packages/core/src/runtime/runner.test.ts
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CapabilityRunner } from "./runner";
import { CapabilityExecutionError } from "./errors";
import { InMemoryEventPublisher } from "../events";
import { DesignFlowError, type Capability, type CapabilityContext } from "@designflow/sdk";

const createMockLogger = () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
});

const createMockContext = (overrides?: Partial<CapabilityContext>): CapabilityContext => ({
  executionId: "exec-1",
  workflowId: "wf-1",
  capabilityId: "cap-1",
  logger: createMockLogger(),
  artifactRefs: [],
  parentArtifacts: [],
  artifactStore: {
    save: async () => ({ id: "test-artifact", type: "test", metadata: {} }),
    get: async () => null,
    exists: async () => false,
  },
  config: {},
  signal: new AbortController().signal,
  ...overrides,
});

const inputSchema: z.ZodType<{ value: string }> = z.object({ value: z.string() });
const outputSchema: z.ZodType<{ artifactRef: { id: string; type: string } }> = z.object({ artifactRef: z.object({ id: z.string(), type: z.string() }) });

type TestInput = z.infer<typeof inputSchema>;
type TestOutput = z.infer<typeof outputSchema>;

const createMockCapability = (
  overrides?: Partial<Capability<TestInput, TestOutput>>,
): Capability<TestInput, TestOutput> => ({
  id: "cap-1",
  name: "Test Capability",
  description: "A test capability",
  type: "pure",
  inputSchema,
  outputSchema,
  execute: async (_ctx, _input) => ({
    artifactRef: { id: "test-artifact", type: "test" },
  }),
  ...overrides,
});

describe("CapabilityRunner", () => {
  test("successful capability execution returns validated output", async () => {
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const capability = createMockCapability();
    const context = createMockContext();

    const output = await runner.run(capability, { value: "hello" }, context);

    expect(output).toEqual({
      artifactRef: { id: "test-artifact", type: "test" },
    });
  });

  test("input schema rejection throws CapabilityExecutionError", async () => {
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const capability = createMockCapability();
    const context = createMockContext();

    let caught: unknown = null;
    try {
      await runner.run(capability, { value: 123 }, context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CapabilityExecutionError);
    const err = caught as CapabilityExecutionError;
    expect(err.message).toContain("Input validation failed");
  });

  test("output schema rejection throws CapabilityExecutionError", async () => {
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const capability = createMockCapability({
      execute: async () => "invalid-output" as unknown as TestOutput,
    });
    const context = createMockContext();

    let caught: unknown = null;
    try {
      await runner.run(capability, { value: "hello" }, context);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CapabilityExecutionError);
    const err = caught as CapabilityExecutionError;
    expect(err.message).toContain("Output validation failed");
  });

  test("retry works on transient failures", async () => {
    let attempts = 0;
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const capability = createMockCapability({
      execute: async (_ctx, _input) => {
        attempts++;
        if (attempts < 3) {
          throw new Error("transient failure");
        }
        return { artifactRef: { id: "test-artifact", type: "test" } };
      },
    });
    const context = createMockContext();

    const output = await runner.run(capability, { value: "hello" }, context, {
      retryPolicy: { maxAttempts: 3, delay: 10 },
      timeout: undefined,
    });

    expect(attempts).toBe(3);
    expect(output).toEqual({
      artifactRef: { id: "test-artifact", type: "test" },
    });
  });

  test("retry exhausts all attempts and throws on persistent failure", async () => {
    let attempts = 0;
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const capability = createMockCapability({
      execute: async (_ctx, _input) => {
        attempts++;
        throw new Error("persistent failure");
      },
    });
    const context = createMockContext();

    let caught: unknown = null;
    try {
      await runner.run(capability, { value: "hello" }, context, {
        retryPolicy: { maxAttempts: 3, delay: 10 },
        timeout: undefined,
      });
    } catch (error) {
      caught = error;
    }

    expect(attempts).toBe(3);
    expect(caught).toBeInstanceOf(CapabilityExecutionError);
    const err = caught as CapabilityExecutionError;
    expect(err.metadata.attempt).toBe(3);
  });

  test("timeout fires, throws CapabilityExecutionError, and aborts signal", async () => {
    let capturedSignal: AbortSignal | undefined;
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const capability = createMockCapability({
      execute: async (ctx, _input) => {
        capturedSignal = ctx.signal;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return { artifactRef: { id: "test-artifact", type: "test" } };
      },
    });
    const context = createMockContext();

    let caught: unknown = null;
    try {
      await runner.run(capability, { value: "hello" }, context, {
        timeout: 50,
        retryPolicy: undefined,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CapabilityExecutionError);
    const err = caught as CapabilityExecutionError;
    expect(err.message).toContain("timed out");
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(true);
  });

  test("abort signal is propagated to capability context", async () => {
    let capturedSignal: AbortSignal | undefined;
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const abortController = new AbortController();
    const capability = createMockCapability({
      execute: async (ctx, _input) => {
        capturedSignal = ctx.signal;
        return { artifactRef: { id: "test-artifact", type: "test" } };
      },
    });
    const context = createMockContext({
      signal: abortController.signal,
    });

    await runner.run(capability, { value: "hello" }, context);

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });

  test("parent abort propagates to combined signal during execution", async () => {
    const runner = new CapabilityRunner(new InMemoryEventPublisher());
    const abortController = new AbortController();
    const capability = createMockCapability({
      execute: async (ctx, _input) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        if (ctx.signal.aborted) {
          throw new Error("aborted by parent");
        }
        return { artifactRef: { id: "test-artifact", type: "test" } };
      },
    });
    const context = createMockContext({
      signal: abortController.signal,
    });

    setTimeout(() => abortController.abort(), 10);

    let caught: unknown = null;
    try {
      await runner.run(capability, { value: "hello" }, context, {
        timeout: 5000,
        retryPolicy: undefined,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
  });
});

// ── Phase 7D: capability.failed carries bounded attempt diagnostics ──

describe("Phase 7D capability failure diagnostics", () => {
  test("a DesignFlowError with failures metadata persists errorCode and bounded attemptDiagnostics on capability.failed", async () => {
    const publisher = new InMemoryEventPublisher();
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publisher.subscribe((event) => { events.push(event); });
    const runner = new CapabilityRunner(publisher);
    const failing = createMockCapability({
      execute: async () => {
        throw new DesignFlowError("ERR_PROPOSAL_ATTEMPTS_EXHAUSTED", "The proposal remained invalid after 3 bounded attempts", {
          attempts: 3,
          attemptsExhausted: true,
          failures: [
            { attempt: 1, code: "ERR_PROPOSAL_TARGET_MISSING", message: "missing", path: "src/a.jsx", operation: "modify" },
            { attempt: 2, code: "ERR_PROPOSAL_TARGET_EXISTS", message: "exists", path: "src/b.jsx", operation: "create" },
            { attempt: 3, code: "ERR_PROPOSAL_MODULE_COMPILE_FAILED", message: "compile", compileErrorSummary: "src/c.jsx: No matching export" },
          ],
        });
      },
    });

    await expect(runner.run(failing, { value: "x" }, createMockContext())).rejects.toMatchObject({ code: "ERR_PROPOSAL_ATTEMPTS_EXHAUSTED" });
    const failed = events.find((event) => event.type === "capability.failed")!;
    expect(failed.payload!.errorCode).toBe("ERR_PROPOSAL_ATTEMPTS_EXHAUSTED");
    const diagnostics = failed.payload!.attemptDiagnostics as Array<Record<string, unknown>>;
    expect(diagnostics.map((d) => d.attempt)).toEqual([1, 2, 3]);
    expect(diagnostics[0]!.path).toBe("src/a.jsx");
    expect(diagnostics[2]!.compileErrorSummary).toBe("src/c.jsx: No matching export");
  });

  test("a DesignFlowError with retryAfterSeconds metadata persists a bounded value on capability.failed", async () => {
    const publisher = new InMemoryEventPublisher();
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publisher.subscribe((event) => { events.push(event); });
    const runner = new CapabilityRunner(publisher);
    const failing = createMockCapability({
      execute: async () => {
        throw new DesignFlowError("ERR_MODEL_RATE_LIMITED", "The managed AI gateway is rate-limiting requests.", {
          retryAfterSeconds: 42.4,
        });
      },
    });

    await expect(runner.run(failing, { value: "x" }, createMockContext())).rejects.toMatchObject({ code: "ERR_MODEL_RATE_LIMITED" });
    const failed = events.find((event) => event.type === "capability.failed")!;
    expect(failed.payload!.retryAfterSeconds).toBe(43);
  });

  test("malformed retryAfterSeconds metadata is dropped from capability.failed", async () => {
    const publisher = new InMemoryEventPublisher();
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    publisher.subscribe((event) => { events.push(event); });
    const runner = new CapabilityRunner(publisher);
    const failing = createMockCapability({
      execute: async () => {
        throw new DesignFlowError("ERR_MODEL_RATE_LIMITED", "rate limited", { retryAfterSeconds: "soon" });
      },
    });

    await runner.run(failing, { value: "x" }, createMockContext()).catch(() => undefined);
    const failed = events.find((event) => event.type === "capability.failed")!;
    expect(failed.payload!.retryAfterSeconds).toBeUndefined();
  });
});
