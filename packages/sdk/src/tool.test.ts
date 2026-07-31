// packages/sdk/src/tool.test.ts
import { describe, expect, test } from "bun:test";
import {
  toolCallSchema,
  toolManifestSchema,
  toolResultSchema,
  toolSchemaDescriptorSchema,
} from "./tool";
import { agentManifestSchema } from "./agent";
import { agentObservationSchema, shapeOf } from "./agent-observability";

/**
 * The tool contracts.
 *
 * As with the agent decision, most of these are about what the schemas
 * *refuse*: a tool result is the boundary between something outside this
 * process and a decision-maker inside it, so what cannot cross matters more
 * than what can.
 */

const MANIFEST = {
  id: "test-tool",
  name: "Test Tool",
  description: "Does something in tests",
  version: "1.0.0",
  inputSchema: { description: "in", fields: [{ name: "request", type: "string" }] },
  outputSchema: { description: "out", fields: [] },
};

// ── 1. Manifest validation ──────────────────────────────────────

describe("toolManifestSchema", () => {
  test("accepts a complete manifest", () => {
    const manifest = toolManifestSchema.parse(MANIFEST);

    expect(manifest.id).toBe("test-tool");
    expect(manifest.inputSchema.fields[0]?.name).toBe("request");
    // `required` defaults rather than being implicitly true.
    expect(manifest.inputSchema.fields[0]?.required).toBe(false);
  });

  test("requires every identifying field", () => {
    for (const field of ["id", "name", "description", "version"] as const) {
      const { [field]: _removed, ...rest } = MANIFEST;
      expect(() => toolManifestSchema.parse(rest)).toThrow();
    }
  });

  test("requires both schema descriptors", () => {
    const { inputSchema: _in, ...noInput } = MANIFEST;
    const { outputSchema: _out, ...noOutput } = MANIFEST;

    expect(() => toolManifestSchema.parse(noInput)).toThrow();
    expect(() => toolManifestSchema.parse(noOutput)).toThrow();
  });

  test("is strict, so an unknown key cannot widen what a tool claims", () => {
    expect(() =>
      toolManifestSchema.parse({ ...MANIFEST, allowedPaths: ["/"] }),
    ).toThrow();
  });

  test("refuses an unbounded or nonsensical timeout", () => {
    // A ten-minute tool would hold a decision open long past the point anyone
    // is still waiting, and the runtime is the wrong place to find that out.
    expect(() => toolManifestSchema.parse({ ...MANIFEST, timeoutMs: 600_000 })).toThrow();
    expect(() => toolManifestSchema.parse({ ...MANIFEST, timeoutMs: 0 })).toThrow();
    expect(() => toolManifestSchema.parse({ ...MANIFEST, timeoutMs: -1 })).toThrow();
    expect(toolManifestSchema.parse({ ...MANIFEST, timeoutMs: 1_000 }).timeoutMs).toBe(1_000);
  });

  test("descriptors describe shape without carrying a live schema", () => {
    const descriptor = toolSchemaDescriptorSchema.parse({ description: "d" });

    // Serializable end to end — a manifest that could not survive JSON would
    // defeat the point of having one.
    expect(descriptor.fields).toEqual([]);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
  });

  test("rejects a field type outside the known set", () => {
    expect(() =>
      toolManifestSchema.parse({
        ...MANIFEST,
        inputSchema: { description: "in", fields: [{ name: "x", type: "function" }] },
      }),
    ).toThrow();
  });
});

// ── 2. Call validation ──────────────────────────────────────────

describe("toolCallSchema", () => {
  test("accepts a well-formed call", () => {
    const call = toolCallSchema.parse({ id: "c1", toolId: "test-tool", input: { a: 1 } });

    expect(call.id).toBe("c1");
    expect(call.input).toEqual({ a: 1 });
  });

  test("requires a non-empty id identifying one invocation", () => {
    expect(() => toolCallSchema.parse({ id: "", toolId: "t", input: {} })).toThrow();
    expect(() => toolCallSchema.parse({ toolId: "t", input: {} })).toThrow();
  });

  test("requires a non-empty tool id", () => {
    expect(() => toolCallSchema.parse({ id: "c1", toolId: "", input: {} })).toThrow();
  });

  test("is strict", () => {
    expect(() =>
      toolCallSchema.parse({ id: "c1", toolId: "t", input: {}, asRoot: true }),
    ).toThrow();
  });
});

// ── 3. Result union validation ──────────────────────────────────

describe("toolResultSchema", () => {
  const SUCCESS = {
    type: "success",
    callId: "c1",
    toolId: "test-tool",
    output: { ok: true },
    durationMs: 3,
  };

  const FAILURE = {
    type: "failure",
    callId: "c1",
    toolId: "test-tool",
    code: "ERR_TOOL_TIMEOUT",
    message: "The tool took too long to answer.",
    retryable: true,
    durationMs: 1_000,
  };

  test("accepts both members", () => {
    expect(toolResultSchema.parse(SUCCESS).type).toBe("success");
    expect(toolResultSchema.parse(FAILURE).type).toBe("failure");
  });

  test("rejects an unknown result type", () => {
    expect(() => toolResultSchema.parse({ ...SUCCESS, type: "partial" })).toThrow();
  });

  test("a success cannot carry a failure's fields, and vice versa", () => {
    // Strict members are what make the union a real discriminator rather than
    // a suggestion — otherwise a "success" carrying a code would typecheck as
    // one and read as the other.
    expect(() => toolResultSchema.parse({ ...SUCCESS, code: "ERR_X" })).toThrow();
    expect(() => toolResultSchema.parse({ ...FAILURE, output: { ok: true } })).toThrow();
  });

  test("refuses a stack trace or a raw error object", () => {
    // The single most likely place for a path, a connection string or a token
    // to surface. There is no field to put one in.
    for (const key of ["stack", "cause", "error", "originalError", "trace"]) {
      expect(() => toolResultSchema.parse({ ...FAILURE, [key]: "…" })).toThrow();
    }
  });

  test("requires a code and a message on a failure", () => {
    expect(() => toolResultSchema.parse({ ...FAILURE, code: "" })).toThrow();
    expect(() => toolResultSchema.parse({ ...FAILURE, message: "" })).toThrow();
    const { retryable: _r, ...noRetryable } = FAILURE;
    expect(() => toolResultSchema.parse(noRetryable)).toThrow();
  });

  test("refuses a negative duration", () => {
    expect(() => toolResultSchema.parse({ ...SUCCESS, durationMs: -1 })).toThrow();
  });

  test("requires a call id, so a result is always attributable", () => {
    expect(() => toolResultSchema.parse({ ...SUCCESS, callId: "" })).toThrow();
    expect(() => toolResultSchema.parse({ ...FAILURE, toolId: "" })).toThrow();
  });
});

// ── 4. Agent tool permissions ───────────────────────────────────

describe("agentManifestSchema.allowedTools", () => {
  const BASE = {
    id: "a",
    name: "A",
    description: "d",
    version: "1.0.0",
    instructions: "i",
    allowedWorkflows: ["alpha"],
  };

  test("defaults to empty, so a pre-tools manifest still parses", () => {
    // Backward compatibility and the right default on its own merits: an agent
    // granted nothing can call nothing, and nothing has to be revoked.
    expect(agentManifestSchema.parse(BASE).allowedTools).toEqual([]);
  });

  test("accepts an explicit list", () => {
    expect(
      agentManifestSchema.parse({ ...BASE, allowedTools: ["classify-design-task"] })
        .allowedTools,
    ).toEqual(["classify-design-task"]);
  });

  test("rejects a duplicated tool id", () => {
    expect(() =>
      agentManifestSchema.parse({ ...BASE, allowedTools: ["t", "t"] }),
    ).toThrow();
  });

  test("rejects an empty tool id", () => {
    expect(() => agentManifestSchema.parse({ ...BASE, allowedTools: [""] })).toThrow();
  });

  test("a wildcard grants one oddly-named tool, never every tool", () => {
    // Nothing anywhere expands `"*"`. It is a literal id, and the only tool it
    // could match is one actually called `*`.
    const manifest = agentManifestSchema.parse({ ...BASE, allowedTools: ["*"] });

    expect(manifest.allowedTools).toEqual(["*"]);
    expect(manifest.allowedTools.includes("classify-design-task")).toBe(false);
  });
});

// ── 5. Observations carry shape, never content ──────────────────

describe("agentObservationSchema", () => {
  test("accepts each event", () => {
    const events: readonly unknown[] = [
      {
        type: "agent.decision.started",
        agentId: "a",
        workerId: "w",
        requestLength: 12,
        availableWorkflows: ["alpha"],
        availableTools: ["t"],
      },
      { type: "tool.call.started", callId: "c", toolId: "t", inputKeys: ["request"] },
      { type: "tool.call.completed", callId: "c", toolId: "t", durationMs: 2, outputKeys: ["taskType"] },
      {
        type: "tool.call.failed",
        callId: "c",
        toolId: "t",
        code: "ERR_TOOL_TIMEOUT",
        message: "slow",
        retryable: true,
        durationMs: 9,
      },
      {
        type: "agent.decision.completed",
        agentId: "a",
        workerId: "w",
        decision: "run_workflow",
        workflowId: "alpha",
        toolCalls: 1,
        durationMs: 5,
      },
    ];

    for (const event of events) {
      expect(() => agentObservationSchema.parse(event)).not.toThrow();
    }
  });

  test("has nowhere to put the request, the input or the output", () => {
    // The privacy guarantee is structural. There is no field named for any of
    // these, and every member is strict.
    expect(() =>
      agentObservationSchema.parse({
        type: "agent.decision.started",
        agentId: "a",
        workerId: "w",
        requestLength: 12,
        request: "build me a login page",
      }),
    ).toThrow();

    expect(() =>
      agentObservationSchema.parse({
        type: "tool.call.started",
        callId: "c",
        toolId: "t",
        input: { request: "secret" },
      }),
    ).toThrow();

    expect(() =>
      agentObservationSchema.parse({
        type: "tool.call.completed",
        callId: "c",
        toolId: "t",
        durationMs: 1,
        output: { taskType: "page" },
      }),
    ).toThrow();
  });

  test("has nowhere to put private reasoning or a stack", () => {
    for (const key of ["reasoning", "chainOfThought", "stack"]) {
      expect(() =>
        agentObservationSchema.parse({
          type: "agent.decision.completed",
          agentId: "a",
          workerId: "w",
          decision: "decline",
          toolCalls: 0,
          durationMs: 1,
          [key]: "…",
        }),
      ).toThrow();
    }
  });

  test("only the three real decisions are observable", () => {
    expect(() =>
      agentObservationSchema.parse({
        type: "agent.decision.completed",
        agentId: "a",
        workerId: "w",
        decision: "call_tool",
        toolCalls: 0,
        durationMs: 1,
      }),
    ).toThrow();
  });
});

describe("shapeOf", () => {
  test("returns top-level keys of an object", () => {
    expect(shapeOf({ request: "x", depth: 2 })).toEqual(["request", "depth"]);
  });

  test("returns nothing for values that have no keys worth naming", () => {
    // Arrays and primitives get nothing rather than indices — "0,1,2" says
    // nothing and a string's keys would be its characters.
    expect(shapeOf(["a", "b"])).toEqual([]);
    expect(shapeOf("secret")).toEqual([]);
    expect(shapeOf(null)).toEqual([]);
    expect(shapeOf(undefined)).toEqual([]);
    expect(shapeOf(42)).toEqual([]);
  });
});
