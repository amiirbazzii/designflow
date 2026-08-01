// apps/designflow-web/src/api-client.network.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { api } from "./api-client";

/**
 * Proves the primary run flow's network-call *sequence* — not just that each
 * method exists, but that calling them in the order `App.tsx` calls them
 * during a run produces exactly the Worker Task Boundary requests it should:
 * `/workers` → `/workers/:id/tasks` → `/sessions/:id` (polling) →
 * `/results/:id`, and never the retired `/api/workflows/:id/start`.
 */

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("primary run flow network sequence", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
  });

  test("hits /workers -> /workers/:id/tasks -> /sessions/:id -> /results/:id, never /api/workflows/*/start", async () => {
    const calls: string[] = [];

    const worker = {
      id: "w1",
      name: "Worker",
      description: "does things",
      category: "general",
      inputs: [],
    };

    const session = {
      id: "s1",
      workerId: "w1",
      status: "completed",
      executionId: "e1",
    };

    const result = {
      id: "e1",
      workerId: "w1",
      status: "completed",
      summary: "done",
      executionId: "e1",
    };

    global.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);

      switch (url) {
        case "/workers":
          return jsonResponse({ workers: [worker] });
        case "/workers/w1/tasks":
          return jsonResponse({ session });
        case "/sessions/s1":
          return jsonResponse({ session });
        case "/results/e1":
          return jsonResponse({ result });
        default:
          throw new Error(`unexpected fetch: ${url}`);
      }
    }) as typeof fetch;

    // The same order App.tsx's `start()` → `refreshRun()` flow calls them:
    // list the catalogue, submit the task, poll the session, then check
    // whether a result is ready.
    await api.listWorkers();
    await api.startWorkerTask("w1", "field: value", { field: "value" });
    await api.getSession("s1");
    await api.getWorkerResult("e1");

    expect(calls).toEqual([
      "/workers",
      "/workers/w1/tasks",
      "/sessions/s1",
      "/results/e1",
    ]);

    expect(calls.some((url) => url.includes("/api/workflows"))).toBe(false);
  });
});
