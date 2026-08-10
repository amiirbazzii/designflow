// packages/product/src/phase9-trace-visibility.test.ts
import { describe, expect, test } from "bun:test";
import {
  AgentInvocationRuntime,
  createSpecializedAgentRegistry,
  modelImplementationStrategy,
} from "@designflow/agents";
import type { ModelInvoker } from "@designflow/sdk";

import { InMemoryTraceStore, TraceCollector } from "./traces";

/**
 * Phase 9 specialist model-call trace visibility. Specialist invocations
 * flow through the same `AgentInvocationRuntime` seam as the live CLI, with
 * a fake provider — one durable trace per invocation, model calls recorded
 * with provider/model/usage, and no prompt or project source stored.
 */

const IMPLEMENTATION_OUTPUT = {
  files: [{ path: "src/pages/NewPage.jsx", action: "create", content: "export default function NewPage() { return null; }\n", reason: "test" }],
  assumptions: [],
  unresolvedItems: [],
  coverageClaims: [],
};

const SPEC = {
  sourceIdentity: { designFile: "homepage.fig" },
  frames: [],
  hierarchy: [{ id: "n1", name: "Frame" }],
  designTokens: { colors: [], spacing: [], typography: [] },
  components: [],
  layoutBehavior: [],
  responsiveAssumptions: [],
  assets: [],
  interactions: [],
  accessibilityNotes: [],
  ambiguities: [],
  agentVersion: "0.1.0",
};

const PROJECT = {
  projectRootIdentity: "root-1",
  framework: "react",
  sourceRoot: "src",
  stylingStrategy: "css",
  contextFingerprint: "fp-1",
};

function fakeModels(): ModelInvoker {
  let calls = 0;
  return {
    installedProfileIds: () => ["implementation-default"],
    generate: async () => {
      calls += 1;
      return {
        type: "success",
        requestId: `req-${calls}`,
        providerId: "designflow-managed",
        model: "openai/gpt-4o-mini",
        output: IMPLEMENTATION_OUTPUT,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.0001 },
        durationMs: 5,
      };
    },
  };
}

function runtimeFor(store: InMemoryTraceStore): AgentInvocationRuntime {
  return new AgentInvocationRuntime({
    registry: createSpecializedAgentRegistry({ implementationStrategy: modelImplementationStrategy }),
    models: fakeModels(),
    modelsRequired: true,
    tracer: new TraceCollector(store),
  });
}

function implementationRequest(attempt: number, metadata?: Record<string, unknown>) {
  return {
    agentId: "implementation-agent",
    objective: "test",
    input: { designSpecification: SPEC, projectContext: PROJECT },
    attempt,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

describe("Phase 9 specialist trace visibility", () => {
  test("an implementation invocation records one trace with provider, model, and usage", async () => {
    const store = new InMemoryTraceStore();
    const runtime = runtimeFor(store);

    const outcome = await runtime.invoke(
      implementationRequest(1, { executionId: "exec-9", capabilityId: "invoke-implementation-agent" }),
    );
    expect(outcome.type).toBe("success");

    const traces = await store.list();
    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect(trace.agentId).toBe("implementation-agent");
    expect(trace.status).toBe("completed");
    expect(trace.executionId).toBe("exec-9");
    expect(trace.metadata?.["capabilityId"]).toBe("invoke-implementation-agent");
    expect(trace.modelCalls.length).toBe(1);
    const call = trace.modelCalls[0]!;
    expect(call.providerId).toBe("designflow-managed");
    expect(call.model).toBe("openai/gpt-4o-mini");
    expect(call.status).toBe("success");
    expect(call.usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.0001 });
  });

  test("multiple proposal attempts each appear exactly once, without duplicates", async () => {
    const store = new InMemoryTraceStore();
    const runtime = runtimeFor(store);

    await runtime.invoke(implementationRequest(1));
    await runtime.invoke(implementationRequest(2));
    await runtime.invoke(implementationRequest(3));

    const traces = await store.list();
    expect(traces.length).toBe(3);
    expect(new Set(traces.map((trace) => trace.id)).size).toBe(3);
    for (const trace of traces) expect(trace.modelCalls.length).toBe(1);
  });

  test("neither prompts nor project source content are stored in the trace", async () => {
    const store = new InMemoryTraceStore();
    const runtime = runtimeFor(store);
    await runtime.invoke(implementationRequest(1));

    const serialized = JSON.stringify(await store.list());
    expect(serialized).not.toContain("designSpecification");
    expect(serialized).not.toContain("NewPage");
    expect(serialized).not.toContain("Objective:");
    expect(serialized).not.toContain("homepage.fig");
  });

  test("a failed model call records a failed trace with the stable error code", async () => {
    const store = new InMemoryTraceStore();
    const runtime = new AgentInvocationRuntime({
      registry: createSpecializedAgentRegistry({ implementationStrategy: modelImplementationStrategy }),
      models: {
        installedProfileIds: () => ["implementation-default"],
        generate: async () => ({
          type: "failure",
          requestId: "req-1",
          code: "ERR_MODEL_AUTHENTICATION",
          message: "session expired",
          retryable: false,
          durationMs: 3,
        }),
      },
      modelsRequired: true,
      tracer: new TraceCollector(store),
    });

    const outcome = await runtime.invoke(implementationRequest(1));
    expect(outcome.type).toBe("failure");

    const traces = await store.list();
    expect(traces.length).toBe(1);
    expect(traces[0]!.status).toBe("failed");
    expect(traces[0]!.modelCalls[0]!.status).toBe("failure");
    expect(traces[0]!.modelCalls[0]!.errorCode).toBe("ERR_MODEL_AUTHENTICATION");
  });
});
