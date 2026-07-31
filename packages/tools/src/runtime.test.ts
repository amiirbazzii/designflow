// packages/tools/src/runtime.test.ts
import { describe, expect, test } from "bun:test";
import { DesignFlowError } from "@designflow/sdk";
import type {
  AgentObservation,
  Tool,
  ToolContext,
  ToolManifest,
  ToolResult,
} from "@designflow/sdk";
import { z } from "zod";
import { InMemoryToolRegistry } from "./registry";
import { ToolRuntime } from "./runtime";

/**
 * The tool boundary.
 *
 * Every test here is about what the runtime refuses, stops or sanitises. A
 * tool's input is untrusted because an agent produced it, and a tool's output
 * is untrusted because something outside this process produced it — so both
 * are parsed, and neither the agent nor the tool is trusted to have behaved.
 */

// ── Harness ─────────────────────────────────────────────────────

const MANIFEST: ToolManifest = {
  id: "test-tool",
  name: "Test Tool",
  description: "Does something in tests",
  version: "1.0.0",
  inputSchema: { description: "in", fields: [] },
  outputSchema: { description: "out", fields: [] },
};

const inputSchema = z.object({ value: z.string() }).strict();
const outputSchema = z.object({ echoed: z.string() }).strict();

interface ToolOverrides {
  readonly execute?: (
    input: { value: string },
    context: ToolContext,
  ) => Promise<unknown>;
  readonly manifest?: Partial<ToolManifest>;
}

function tool(overrides: ToolOverrides = {}): Tool {
  const execute =
    overrides.execute ??
    ((input: { value: string }) => Promise.resolve({ echoed: input.value }));

  return {
    manifest: { ...MANIFEST, ...overrides.manifest },
    inputSchema,
    // Cast at the seam a real tool's output crosses: the runtime's job is to
    // validate an untrusted answer, so a test must be able to return one that
    // does not satisfy the schema.
    outputSchema: outputSchema as unknown as Tool["outputSchema"],
    execute: execute as Tool["execute"],
  } as Tool;
}

function runtimeFor(
  installed: readonly Tool[],
  observer?: { observe: (observation: AgentObservation) => void },
): ToolRuntime {
  return new ToolRuntime({
    registry: new InMemoryToolRegistry(installed),
    ...(observer !== undefined ? { observer } : {}),
  });
}

const CALL = { id: "call-1", toolId: "test-tool", input: { value: "hello" } };
const ALLOWED = ["test-tool"];

function expectFailure(result: ToolResult): Extract<ToolResult, { type: "failure" }> {
  if (result.type !== "failure") {
    throw new Error(`expected a failure, got ${result.type}`);
  }
  return result;
}

// ── 9. An authorised call succeeds ──────────────────────────────

describe("an authorised call", () => {
  test("returns the tool's parsed output", async () => {
    const result = await runtimeFor([tool()]).invoke({
      call: CALL,
      allowedTools: ALLOWED,
    });

    expect(result.type).toBe("success");
    if (result.type !== "success") return;

    expect(result.output).toEqual({ echoed: "hello" });
    expect(result.callId).toBe("call-1");
    expect(result.toolId).toBe("test-tool");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("passes a restricted context and nothing else", async () => {
    let seen: ToolContext | null = null;

    await runtimeFor([
      tool({
        execute: (input, context) => {
          seen = context;
          return Promise.resolve({ echoed: input.value });
        },
      }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    const context = seen as ToolContext | null;

    // No tools port: a tool that could call tools could recurse, and a bounded
    // decision would stop being bounded.
    expect(Object.keys(context ?? {}).sort()).toEqual([
      "logger",
      "metadata",
      "signal",
    ]);
  });
});

// ── 10/11. Permission and installation ──────────────────────────

describe("refusing a call", () => {
  test("an unpermitted tool fails with ERR_TOOL_NOT_ALLOWED", async () => {
    const result = await runtimeFor([tool()]).invoke({
      call: CALL,
      allowedTools: [],
    });

    expect(expectFailure(result).code).toBe("ERR_TOOL_NOT_ALLOWED");
  });

  test("an uninstalled tool fails with ERR_TOOL_NOT_FOUND", async () => {
    const result = await runtimeFor([]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(expectFailure(result).code).toBe("ERR_TOOL_NOT_FOUND");
  });

  test("permission is checked before existence, so probing reveals nothing", async () => {
    // An unpermitted call answers identically whether the tool exists or not.
    // Otherwise the difference would let a caller enumerate what is installed.
    const installed = await runtimeFor([tool()]).invoke({ call: CALL, allowedTools: [] });
    const absent = await runtimeFor([]).invoke({ call: CALL, allowedTools: [] });

    expect(expectFailure(installed).code).toBe(expectFailure(absent).code);
    expect(expectFailure(installed).message).toBe(expectFailure(absent).message);
  });

  test("an unpermitted tool is never executed", async () => {
    let ran = false;

    await runtimeFor([
      tool({
        execute: () => {
          ran = true;
          return Promise.resolve({ echoed: "x" });
        },
      }),
    ]).invoke({ call: CALL, allowedTools: [] });

    expect(ran).toBe(false);
  });

  test("a malformed call throws, because there is no id to fail on", async () => {
    const runtime = runtimeFor([tool()]);

    try {
      await runtime.invoke({
        call: { id: "", toolId: "test-tool", input: {} },
        allowedTools: ALLOWED,
      });
      throw new Error("expected the runtime to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_TOOL_CALL_INVALID");
    }
  });
});

// ── 4/16. Input and output are both parsed ──────────────────────

describe("schema enforcement", () => {
  test("invalid input fails with ERR_TOOL_INPUT_INVALID", async () => {
    const result = await runtimeFor([tool()]).invoke({
      call: { ...CALL, input: { value: 42 } },
      allowedTools: ALLOWED,
    });

    expect(expectFailure(result).code).toBe("ERR_TOOL_INPUT_INVALID");
  });

  test("invalid input never reaches the tool", async () => {
    let ran = false;

    await runtimeFor([
      tool({
        execute: () => {
          ran = true;
          return Promise.resolve({ echoed: "x" });
        },
      }),
    ]).invoke({ call: { ...CALL, input: null }, allowedTools: ALLOWED });

    expect(ran).toBe(false);
  });

  test("invalid output fails with ERR_TOOL_OUTPUT_INVALID", async () => {
    // The output boundary matters as much as the input one: whatever a tool
    // returns came from outside this process, and handing it to a
    // decision-maker unparsed would make the implementation the contract.
    const result = await runtimeFor([
      tool({ execute: () => Promise.resolve({ wrong: "shape" }) }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(expectFailure(result).code).toBe("ERR_TOOL_OUTPUT_INVALID");
  });

  test("extra keys in the output are refused, not passed through", async () => {
    const result = await runtimeFor([
      tool({
        execute: () => Promise.resolve({ echoed: "hi", injected: "surprise" }),
      }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(expectFailure(result).code).toBe("ERR_TOOL_OUTPUT_INVALID");
  });
});

// ── 12/13/14. Timeout, abort and cleanup ────────────────────────

describe("timeout and cancellation", () => {
  /** A tool that ignores its signal entirely. The hard case. */
  const stubborn = (): Tool =>
    tool({
      manifest: { timeoutMs: 30 },
      execute: () => new Promise(() => {}),
    });

  test("a tool that never returns is stopped by the timeout", async () => {
    // Enforced by racing rather than delegated to the tool's good manners: a
    // tool that ignores its signal would otherwise hold the decision forever.
    const result = await runtimeFor([stubborn()]).invoke({
      call: CALL,
      allowedTools: ALLOWED,
    });

    const failure = expectFailure(result);
    expect(failure.code).toBe("ERR_TOOL_TIMEOUT");
    expect(failure.retryable).toBe(true);
    expect(failure.durationMs).toBeGreaterThanOrEqual(25);
  });

  test("a cooperative tool sees the composed signal fire", async () => {
    let observedAbort = false;

    await runtimeFor([
      tool({
        manifest: { timeoutMs: 20 },
        execute: (_input, context) =>
          new Promise((resolve) => {
            context.signal.addEventListener("abort", () => {
              observedAbort = true;
              resolve({ echoed: "late" });
            });
          }),
      }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(observedAbort).toBe(true);
  });

  test("parent cancellation propagates and is reported, not swallowed", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 15);

    const result = await runtimeFor([
      tool({ manifest: { timeoutMs: 5_000 }, execute: () => new Promise(() => {}) }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED, signal: controller.signal });

    // A cancelled caller must not receive something that reads as a tool
    // having declined to answer.
    expect(expectFailure(result).code).toBe("ERR_TOOL_ABORTED");
  });

  test("an already-aborted parent refuses before the tool runs", async () => {
    const controller = new AbortController();
    controller.abort();

    let ran = false;
    const result = await runtimeFor([
      tool({
        execute: () => {
          ran = true;
          return Promise.resolve({ echoed: "x" });
        },
      }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED, signal: controller.signal });

    expect(expectFailure(result).code).toBe("ERR_TOOL_ABORTED");
    expect(ran).toBe(false);
  });

  test("the parent listener is removed after every call", async () => {
    const controller = new AbortController();
    const { signal } = controller;

    const added: unknown[] = [];
    const removed: unknown[] = [];

    const originalAdd = signal.addEventListener.bind(signal);
    const originalRemove = signal.removeEventListener.bind(signal);

    signal.addEventListener = ((...args: Parameters<typeof originalAdd>) => {
      added.push(args[1]);
      return originalAdd(...args);
    }) as typeof signal.addEventListener;

    signal.removeEventListener = ((...args: Parameters<typeof originalRemove>) => {
      removed.push(args[1]);
      return originalRemove(...args);
    }) as typeof signal.removeEventListener;

    const runtime = runtimeFor([tool()]);
    for (let index = 0; index < 5; index++) {
      await runtime.invoke({
        call: { ...CALL, id: `call-${index}` },
        allowedTools: ALLOWED,
        signal,
      });
    }

    // One listener added and removed per call. Without the removal these would
    // accumulate on a signal that outlives every call made with it.
    expect(added.length).toBe(5);
    expect(removed.length).toBe(5);
    expect(new Set(removed)).toEqual(new Set(added));
  });

  test("the timeout timer is cleared when a tool returns promptly", async () => {
    const cleared: unknown[] = [];
    const originalClear = globalThis.clearTimeout;

    globalThis.clearTimeout = ((handle: Parameters<typeof originalClear>[0]) => {
      cleared.push(handle);
      return originalClear(handle);
    }) as typeof globalThis.clearTimeout;

    try {
      await runtimeFor([tool()]).invoke({ call: CALL, allowedTools: ALLOWED });
    } finally {
      globalThis.clearTimeout = originalClear;
    }

    // Otherwise a fast tool would still hold the process open for the whole of
    // its timeout.
    expect(cleared.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 15. Execution failures are sanitised ────────────────────────

describe("sanitising a thrown error", () => {
  test("a throwing tool fails with ERR_TOOL_EXECUTION_FAILED", async () => {
    const result = await runtimeFor([
      tool({ execute: () => Promise.reject(new Error("disk on fire")) }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    const failure = expectFailure(result);
    expect(failure.code).toBe("ERR_TOOL_EXECUTION_FAILED");
    expect(failure.message).toBe("disk on fire");
  });

  test("no stack trace survives", async () => {
    const result = await runtimeFor([
      tool({
        execute: () => {
          const error = new Error("boom");
          error.stack = "Error: boom\n    at /Users/someone/secret/path.ts:1:1";
          return Promise.reject(error);
        },
      }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/Users/someone");
    expect(serialized).not.toContain("    at ");
    // The result carries exactly the schema's fields — there is nowhere for a
    // stack, a cause or the original error object to ride along.
    expect(Object.keys(result).sort()).toEqual([
      "callId",
      "code",
      "durationMs",
      "message",
      "retryable",
      "toolId",
      "type",
    ]);
  });

  test("a multi-line message is collapsed so it cannot forge structure", async () => {
    const result = await runtimeFor([
      tool({ execute: () => Promise.reject(new Error("line one\n\nline two")) }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(expectFailure(result).message).toBe("line one line two");
  });

  test("a very long message is truncated", async () => {
    const result = await runtimeFor([
      tool({ execute: () => Promise.reject(new Error("x".repeat(5_000))) }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(expectFailure(result).message.length).toBeLessThanOrEqual(201);
  });

  test("a non-Error throw still produces a usable message", async () => {
    const result = await runtimeFor([
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      tool({ execute: () => Promise.reject({ weird: true }) }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(expectFailure(result).message).toBe("The tool failed without an explanation.");
  });
});

// ── Observation ─────────────────────────────────────────────────

describe("observing a call", () => {
  test("emits started and completed, with shapes but no data", async () => {
    const seen: AgentObservation[] = [];

    await runtimeFor([tool()], { observe: (o) => seen.push(o) }).invoke({
      call: CALL,
      allowedTools: ALLOWED,
      agentId: "a",
      workerId: "w",
    });

    expect(seen.map((event) => event.type)).toEqual([
      "tool.call.started",
      "tool.call.completed",
    ]);

    const serialized = JSON.stringify(seen);
    expect(serialized).toContain("value");
    expect(serialized).not.toContain("hello");
  });

  test("emits failed with the code, and no raw error", async () => {
    const seen: AgentObservation[] = [];

    await runtimeFor([tool({ execute: () => Promise.reject(new Error("nope")) })], {
      observe: (o) => seen.push(o),
    }).invoke({ call: CALL, allowedTools: ALLOWED });

    const failed = seen.find((event) => event.type === "tool.call.failed");
    expect(failed).toBeDefined();
    expect(JSON.stringify(seen)).not.toContain("stack");
  });

  test("an observer that throws cannot break the call", async () => {
    const result = await runtimeFor([tool()], {
      observe: () => {
        throw new Error("observer exploded");
      },
    }).invoke({ call: CALL, allowedTools: ALLOWED });

    // Adding observability must never be riskier than going without.
    expect(result.type).toBe("success");
  });

  test("the default observer is a no-op", async () => {
    const result = await runtimeFor([tool()]).invoke({ call: CALL, allowedTools: ALLOWED });

    expect(result.type).toBe("success");
  });
});

// ── The runtime executes nothing but the tool ───────────────────

describe("what the runtime does not do", () => {
  test("calls the tool exactly once and never retries", async () => {
    let calls = 0;

    await runtimeFor([
      tool({
        execute: () => {
          calls += 1;
          return Promise.reject(new Error("fail"));
        },
      }),
    ]).invoke({ call: CALL, allowedTools: ALLOWED });

    // Whether to try again is a decision, which belongs to the agent and its
    // budget — not to a layer that would retry invisibly.
    expect(calls).toBe(1);
  });

  test("reports the installed ids for narrowing, not the tools themselves", () => {
    const runtime = runtimeFor([tool()]);

    expect(runtime.installedToolIds()).toEqual(["test-tool"]);
  });
});
