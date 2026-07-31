// packages/product/src/worker-task.test.ts
import { describe, expect, test } from "bun:test";
import { DesignFlowError, workerManifestSchema } from "@designflow/sdk";
import type {
  AgentDecisionService,
  AgentExecutionResult,
  AgentTask,
  WorkerManifest,
  WorkerRegistry,
} from "@designflow/sdk";
import { WorkerTaskRouter } from "./worker-task";

/**
 * The product boundary.
 *
 * One question in, one decision out — and the same shape whether an agent was
 * involved or not. These tests are mostly about that uniformity, because it is
 * what lets a surface stay ignorant of which workflow gets chosen.
 */

// ── Harness ─────────────────────────────────────────────────────

function worker(overrides: Partial<WorkerManifest> = {}): WorkerManifest {
  return workerManifestSchema.parse({
    id: "legacy-worker",
    name: "Legacy Worker",
    description: "Maps straight to a workflow",
    category: "testing",
    workflows: ["alpha"],
    ...overrides,
  });
}

/** A registry over a fixed list, which is all the router needs. */
function registry(workers: readonly WorkerManifest[]): WorkerRegistry {
  return {
    listWorkers: () => workers,
    getWorker: (id) => workers.find((candidate) => candidate.id === id),
    registerWorker: () => {
      throw new Error("not used");
    },
  };
}

/** An agent service that answers with whatever the test tells it to. */
function agents(
  result: AgentExecutionResult["decision"],
  onTask?: (task: AgentTask) => void,
): AgentDecisionService {
  return {
    decide: (task): Promise<AgentExecutionResult> => {
      onTask?.(task);
      return Promise.resolve({
        agentId: task.agentId,
        workerId: task.workerId,
        decision: result,
      });
    },
  };
}

// ── Legacy workers ──────────────────────────────────────────────

describe("a worker with no agent", () => {
  test("resolves straight to its primary workflow", async () => {
    const router = new WorkerTaskRouter({ workers: registry([worker()]) });

    const result = await router.route({
      workerId: "legacy-worker",
      request: "do the thing",
    });

    expect(result.decision).toEqual({ type: "run_workflow", workflowId: "alpha" });
    expect(result.worker.id).toBe("legacy-worker");
  });

  test("takes the first workflow when several are named", async () => {
    const router = new WorkerTaskRouter({
      workers: registry([worker({ workflows: ["alpha", "beta"] })]),
    });

    const result = await router.route({ workerId: "legacy-worker", request: "" });

    expect(result.decision).toMatchObject({ workflowId: "alpha" });
  });

  test("carries the caller's input through", async () => {
    const router = new WorkerTaskRouter({ workers: registry([worker()]) });

    const result = await router.route({
      workerId: "legacy-worker",
      request: "",
      input: { designFile: "homepage.fig" },
    });

    expect(result.decision).toMatchObject({ input: { designFile: "homepage.fig" } });
  });

  test("needs no agent runtime at all", async () => {
    // A host with no agents installed still routes. This is the whole
    // backward-compatibility claim.
    const router = new WorkerTaskRouter({ workers: registry([worker()]) });

    expect((await router.route({ workerId: "legacy-worker", request: "x" })).decision.type).toBe(
      "run_workflow",
    );
  });

  test("consults no agent even when one is available", async () => {
    let consulted = false;

    const router = new WorkerTaskRouter({
      workers: registry([worker()]),
      agents: agents({ type: "decline", reason: "should not be asked" }, () => {
        consulted = true;
      }),
    });

    await router.route({ workerId: "legacy-worker", request: "x" });

    expect(consulted).toBe(false);
  });
});

// ── Agent-backed workers ────────────────────────────────────────

describe("a worker that delegates to an agent", () => {
  const backed = worker({ id: "agent-worker", agentId: "test-agent" });

  test("returns the agent's decision", async () => {
    const router = new WorkerTaskRouter({
      workers: registry([backed]),
      agents: agents({ type: "run_workflow", workflowId: "beta" }),
    });

    const result = await router.route({ workerId: "agent-worker", request: "go" });

    // Not `workflows[0]`. The agent chose, and the boundary did not second-guess it.
    expect(result.decision).toEqual({ type: "run_workflow", workflowId: "beta" });
  });

  test("hands the agent the worker id, agent id, request and input", async () => {
    let seen: AgentTask | null = null;

    const router = new WorkerTaskRouter({
      workers: registry([backed]),
      agents: agents({ type: "run_workflow", workflowId: "alpha" }, (task) => {
        seen = task;
      }),
    });

    await router.route({
      workerId: "agent-worker",
      request: "build the homepage",
      input: { designFile: "homepage.fig" },
    });

    expect(seen as AgentTask | null).toEqual({
      workerId: "agent-worker",
      agentId: "test-agent",
      request: "build the homepage",
      input: { designFile: "homepage.fig" },
    });
  });

  test("returns a clarification unchanged", async () => {
    const router = new WorkerTaskRouter({
      workers: registry([backed]),
      agents: agents({ type: "request_clarification", question: "Which design?" }),
    });

    const result = await router.route({ workerId: "agent-worker", request: "" });

    expect(result.decision).toEqual({
      type: "request_clarification",
      question: "Which design?",
    });
  });

  test("returns a decline unchanged", async () => {
    const router = new WorkerTaskRouter({
      workers: registry([backed]),
      agents: agents({ type: "decline", reason: "Out of scope" }),
    });

    const result = await router.route({ workerId: "agent-worker", request: "x" });

    expect(result.decision).toEqual({ type: "decline", reason: "Out of scope" });
  });

  test("refuses to route when no agent runtime is wired", async () => {
    // Refused rather than falling back to `workflows[0]`, which would look
    // like it worked while skipping the agent's allow-list.
    const router = new WorkerTaskRouter({ workers: registry([backed]) });

    try {
      await router.route({ workerId: "agent-worker", request: "x" });
      throw new Error("expected the router to refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(DesignFlowError);
      expect((error as DesignFlowError).code).toBe("ERR_AGENT_RUNTIME_UNAVAILABLE");
    }
  });
});

// ── Both paths look the same from outside ───────────────────────

describe("the shape a caller sees", () => {
  test("is a decision either way", async () => {
    const legacy = new WorkerTaskRouter({ workers: registry([worker()]) });

    const backed = new WorkerTaskRouter({
      workers: registry([worker({ id: "agent-worker", agentId: "test-agent" })]),
      agents: agents({ type: "run_workflow", workflowId: "alpha" }),
    });

    const first = await legacy.route({ workerId: "legacy-worker", request: "x" });
    const second = await backed.route({ workerId: "agent-worker", request: "x" });

    // A surface renders one shape and cannot tell whether an agent was
    // involved — the property that would rot if legacy returned a workflow id.
    expect(Object.keys(first).sort()).toEqual(Object.keys(second).sort());
    expect(first.decision.type).toBe(second.decision.type);
  });
});

// ── Resolution and validation ───────────────────────────────────

describe("resolving the worker", () => {
  test("refuses an unknown worker with the catalogue's own code", async () => {
    const router = new WorkerTaskRouter({ workers: registry([]) });

    try {
      await router.route({ workerId: "nobody", request: "x" });
      throw new Error("expected the router to refuse");
    } catch (error) {
      // The code is the contract, not the class: a caller matching on it must
      // not have to care which layer refused.
      expect((error as DesignFlowError).code).toBe("ERR_WORKER_NOT_FOUND");
    }
  });

  test("routes a manifest the caller already holds, catalogue or not", async () => {
    // The CLI synthesises a manifest for a workflow no worker owns. It is a
    // valid legacy worker but is in no catalogue, so a lookup by id would
    // refuse work that is legitimately reachable.
    const router = new WorkerTaskRouter({ workers: registry([]) });

    const result = await router.routeWorker(worker({ id: "unlisted" }), {
      workerId: "unlisted",
      request: "x",
    });

    expect(result.decision).toEqual({ type: "run_workflow", workflowId: "alpha" });
  });

  test("defaults an omitted request to empty rather than refusing it", async () => {
    const router = new WorkerTaskRouter({ workers: registry([worker()]) });

    const result = await router.route({
      workerId: "legacy-worker",
    } as unknown as { workerId: string; request: string });

    expect(result.decision.type).toBe("run_workflow");
  });

  test("refuses a request with no worker id", async () => {
    const router = new WorkerTaskRouter({ workers: registry([worker()]) });

    expect(router.route({ workerId: "", request: "x" })).rejects.toThrow();
  });
});
