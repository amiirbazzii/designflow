// packages/core/src/runtime/runner.test.ts
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { CapabilityRunner } from "./runner";
import { CapabilityExecutionError } from "./errors";
import { InMemoryEventPublisher } from "../events";
import type { Capability, CapabilityContext, ArtifactRef, ArtifactStore } from "@designflow/sdk";

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
