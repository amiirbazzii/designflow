// apps/designflow-api/src/api.adversarial.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHost, type ApiHost, type ApiHostOptions } from "./host";
import { createRouter } from "./router";

/**
 * Adversarial verification of the HTTP API / WorkerResult contract.
 *
 * Not a re-run of api.test.ts's happy paths — every test here tries
 * something a hostile or careless client might send, and asserts the
 * contract survives it: no leaked internal vocabulary, no crash, a stable
 * error code, and no field smuggled past a route that should not honour it.
 */

// ── Harness (same pattern as api.test.ts) ────────────────────────

const workspaces: string[] = [];
const openHosts: ApiHost[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-api-adv-"));
  workspaces.push(dir);
  return join(dir, "test.sqlite");
}

interface Client {
  readonly host: ApiHost;
  get(path: string): Promise<{ status: number; body: Record<string, unknown>; raw: string }>;
  post(
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown>; raw: string }>;
}

function createClient(options?: ApiHostOptions): Client {
  const host = createApiHost({ databasePath: databasePath(), ...options });
  openHosts.push(host);
  const handle = createRouter(host);

  const send = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown>; raw: string }> => {
    const request = new Request(`http://localhost${path}`, {
      method,
      ...(body !== undefined
        ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
        : {}),
    });

    const response = await handle(request);
    const raw = await response.text();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // leave parsed as {}
    }

    return {
      status: response.status,
      body:
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? { ...(parsed as Record<string, unknown>) }
          : {},
      raw,
    };
  };

  return { host, get: (p) => send("GET", p), post: (p, b) => send("POST", p, b ?? {}) };
}

function pick(body: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = body;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function waitForStatus(
  client: Client,
  executionId: string,
  status: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await client.get(`/api/executions/${executionId}`);
    const current = pick(response.body, ["status", "state"]);
    if (current === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`execution ${executionId} never reached ${status}`);
}

afterEach(() => {
  for (const host of openHosts.splice(0)) host.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Every raw response body collected across the whole suite, for the
// forbidden-string sweep at the end (item 10).
const ALL_RESPONSE_BODIES: string[] = [];

function record(raw: string): void {
  ALL_RESPONSE_BODIES.push(raw);
}

const ALL_ERROR_CODES = new Set<string>();

function recordErrorCode(body: Record<string, unknown>): void {
  const code = pick(body, ["error", "code"]);
  if (typeof code === "string") ALL_ERROR_CODES.add(code);
}

const DESIGN_INPUT = {
  designFile: "homepage.fig",
  framework: "react",
  frames: ["brand/Header", "brand/Footer", "layout/Dashboard"],
};

const KNOWN_WORKER_KEYS = ["id", "name", "description", "category", "inputs", "evaluationCriteria", "projectContext", "metadata"];

// ── 1. GET /workers strips internal vocabulary ───────────────────

describe("1. GET /workers", () => {
  test("every worker has no agentId/workflows/workflowId/modelProfileId and has all expected public keys", async () => {
    const client = createClient();
    const response = await client.get("/workers");
    record(response.raw);

    expect(response.status).toBe(200);
    const workers = response.body["workers"] as Record<string, unknown>[];
    expect(workers.length).toBe(4);

    for (const worker of workers) {
      const keys = Object.keys(worker);
      expect(keys).not.toContain("agentId");
      expect(keys).not.toContain("workflows");
      expect(keys).not.toContain("workflowId");
      expect(keys).not.toContain("modelProfileId");
      expect(keys).not.toContain("toolIds");
      for (const expectedKey of KNOWN_WORKER_KEYS) {
        expect(keys).toContain(expectedKey);
      }
    }
  });
});

// ── 2. GET /workers/:workerId with hostile ids ────────────────────

describe("2. GET /workers/:workerId with path-traversal / injection ids", () => {
  const hostileIds = [
    "..%2F..%2Fetc",
    "<script>alert(1)</script>",
    "'; DROP TABLE workers; --",
    "%00nullbyte",
    "a".repeat(5000),
  ];

  for (const id of hostileIds) {
    test(`404s cleanly for id ${JSON.stringify(id).slice(0, 40)}`, async () => {
      const client = createClient();
      const response = await client.get(`/workers/${id}`);
      record(response.raw);
      recordErrorCode(response.body);

      expect(response.status).toBe(404);
      // An id containing "/" (e.g. the closing tag in a <script> payload)
      // never reaches the `/workers/:workerId` route at all — it falls
      // through to the router's generic catch-all, which reports
      // ERR_NOT_FOUND rather than ERR_WORKER_NOT_FOUND. Both are a clean,
      // stable 404; only an id with no "/" actually reaches the worker
      // catalogue lookup and gets the more specific code.
      const code = pick(response.body, ["error", "code"]);
      expect(["ERR_WORKER_NOT_FOUND", "ERR_NOT_FOUND"]).toContain(code);
      if (!id.includes("/")) {
        expect(code).toBe("ERR_WORKER_NOT_FOUND");
      }
      // No stack trace / internal path leakage.
      expect(response.raw).not.toContain("at Object.");
      expect(response.raw).not.toContain(".ts:");
      expect(response.raw).not.toMatch(/node_modules/);
    });
  }

  test("literal ../../etc via raw path segment does not escape or crash", async () => {
    const client = createClient();
    // Request constructor + URL normalize ../ segments before pathname is
    // read, so this exercises whatever the router sees after normalization.
    const response = await client.get("/workers/../../etc");
    record(response.raw);
    // Whatever it resolves to, it must not 500 and must not read a file.
    expect(response.status).not.toBe(500);
    expect(response.raw).not.toContain("ENOENT");
  });
});

// ── 3. POST /workers/:workerId/tasks cannot smuggle a workflowId ─

describe("3. POST /workers/:workerId/tasks field smuggling", () => {
  test("a top-level workflowId field is ignored, never honoured", async () => {
    const client = createClient({ requireApproval: false });

    const response = await client.post("/workers/product-manager/tasks", {
      request: "build a new export feature",
      workflowId: "qa-review", // attempt to smuggle a different worker's workflow
      input: { productRequest: "Let users export as CSV", targetUser: "CLI users" },
    });
    record(response.raw);

    expect(response.status).toBe(201);
    const session = response.body["session"] as Record<string, unknown>;
    // The smuggled field must not appear anywhere in the response.
    expect(JSON.stringify(response.body)).not.toContain("qa-review");
    expect(session["workerId"]).toBe("product-manager");

    // Confirm the *actual* workflow run belongs to product-manager, not
    // qa-review, by following the session to its result.
    const executionId = session["executionId"] as string | undefined;
    if (executionId !== undefined) {
      const result = await client.get(`/results/${executionId}`);
      record(result.raw);
      if (result.status === 200) {
        expect(pick(result.body, ["result", "workerId"])).toBe("product-manager");
      }
    }
  });

  test("a workflowId nested inside input is not honoured as the executed workflow", async () => {
    const client = createClient({ requireApproval: false });

    const response = await client.post("/workers/product-manager/tasks", {
      request: "build a new export feature",
      input: {
        productRequest: "Let users export as CSV",
        workflowId: "qa-review",
      },
    });
    record(response.raw);

    expect(response.status).toBe(201);
    const session = response.body["session"] as Record<string, unknown>;
    expect(session["workerId"]).toBe("product-manager");

    const executionId = session["executionId"] as string | undefined;
    if (executionId !== undefined) {
      const result = await client.get(`/results/${executionId}`);
      if (result.status === 200) {
        expect(pick(result.body, ["result", "workerId"])).toBe("product-manager");
      }
    }
  });

  test("an unrecognized top-level field never reaches the session/session store", async () => {
    const client = createClient();

    const response = await client.post("/workers/qa-reviewer/tasks", {
      request: "",
      agentId: "some-other-agent",
      modelProfileId: "some-other-profile",
    });
    record(response.raw);

    expect(response.status).toBe(201);
    expect(JSON.stringify(response.body)).not.toContain("some-other-agent");
    expect(JSON.stringify(response.body)).not.toContain("some-other-profile");
  });
});

// ── 4. POST /workers/:workerId/tasks for an unknown worker ───────

describe("4. POST /workers/:workerId/tasks unknown worker", () => {
  test("404s with a stable code and no internal vocabulary", async () => {
    const client = createClient();

    const response = await client.post("/workers/does-not-exist/tasks", {
      request: "do something",
    });
    record(response.raw);
    recordErrorCode(response.body);

    expect(response.status).toBe(404);
    expect(pick(response.body, ["error", "code"])).toBe("ERR_WORKER_NOT_FOUND");
    const message = String(pick(response.body, ["error", "message"]) ?? "");
    expect(message).not.toContain("agentId");
    expect(message).not.toContain("AgentRuntime");
    expect(message).not.toContain("WorkerRegistry");
  });

  test("hostile worker id in the tasks route also 404s cleanly", async () => {
    const client = createClient();
    const response = await client.post("/workers/../../etc/tasks", { request: "x" });
    record(response.raw);
    expect(response.status).not.toBe(500);
  });
});

// ── 5. Sessions correlate correctly and never leak agentId ───────

describe("5. GET /sessions, GET /sessions/:sessionId", () => {
  test("two sessions for different workers each report their own workerId, never the other's, and never agentId", async () => {
    const client = createClient({ requireApproval: false });

    const started1 = await client.post("/workers/design-engineer/tasks", {
      request: "build a new homepage component",
      input: DESIGN_INPUT,
    });
    const started2 = await client.post("/workers/qa-reviewer/tasks", {});
    record(started1.raw);
    record(started2.raw);

    const session1 = started1.body["session"] as Record<string, unknown>;
    const session2 = started2.body["session"] as Record<string, unknown>;

    expect(session1["workerId"]).toBe("design-engineer");
    expect(session2["workerId"]).toBe("qa-reviewer");
    expect(Object.keys(session1)).not.toContain("agentId");
    expect(Object.keys(session2)).not.toContain("agentId");

    const list = await client.get("/sessions");
    record(list.raw);
    const sessions = list.body["sessions"] as Record<string, unknown>[];

    for (const session of sessions) {
      expect(Object.keys(session)).not.toContain("agentId");
    }

    const found1 = sessions.find((s) => s["id"] === session1["id"]);
    const found2 = sessions.find((s) => s["id"] === session2["id"]);
    expect(found1?.["workerId"]).toBe("design-engineer");
    expect(found2?.["workerId"]).toBe("qa-reviewer");

    // Cross-check via the detail route too.
    const detail1 = await client.get(`/sessions/${session1["id"]}`);
    const detail2 = await client.get(`/sessions/${session2["id"]}`);
    record(detail1.raw);
    record(detail2.raw);

    expect(pick(detail1.body, ["session", "workerId"])).toBe("design-engineer");
    expect(pick(detail2.body, ["session", "workerId"])).toBe("qa-reviewer");
    expect(Object.keys(detail1.body["session"] as object)).not.toContain("agentId");
    expect(Object.keys(detail2.body["session"] as object)).not.toContain("agentId");
  });

  test("GET /sessions/:sessionId with a hostile id 404s cleanly", async () => {
    const client = createClient();
    const response = await client.get("/sessions/../../etc/passwd");
    record(response.raw);
    recordErrorCode(response.body);
    expect(response.status).toBe(404);
  });
});

// ── 6. Answering a session that is not waiting ────────────────────

describe("6. POST /sessions/:sessionId/answers on a non-waiting session", () => {
  test("answering a session that completed without ever asking a question returns a stable 409, not a silent success", async () => {
    const client = createClient({ requireApproval: false });

    // Enough request + structured input for the deterministic agent to
    // decide run_workflow immediately — this session never enters
    // waiting_for_user at all.
    const started = await client.post("/workers/design-engineer/tasks", {
      request: "build a new homepage component",
      input: DESIGN_INPUT,
    });
    const session = started.body["session"] as Record<string, unknown>;
    const sessionId = session["id"] as string;
    record(started.raw);

    expect(session["status"]).not.toBe("waiting_for_user");
    expect(["completed", "declined", "failed", "cancelled"]).toContain(session["status"]);

    const answered = await client.post(`/sessions/${sessionId}/answers`, {
      answer: "an answer nobody asked for",
    });
    record(answered.raw);
    recordErrorCode(answered.body);

    expect(answered.status).toBe(409);
    expect(pick(answered.body, ["error", "code"])).toBe("ERR_SESSION_NOT_WAITING");
    // The session must not have silently advanced.
    expect(answered.body["session"]).toBeUndefined();
  });

  test("answering an already-completed session (after a real clarification round-trip) also returns 409", async () => {
    const client = createClient({ requireApproval: false });

    // product-manager completes on its very first turn once it has *any*
    // request text, so the second answers call below always lands on a
    // session that is no longer waiting.
    const started = await client.post("/workers/product-manager/tasks", {
      request: "build a new CSV export feature",
      input: { productRequest: "Let users export their history as CSV", targetUser: "CLI users" },
    });
    const sessionId = (started.body["session"] as Record<string, unknown>)["id"] as string;
    const status = (started.body["session"] as Record<string, unknown>)["status"];
    expect(status).not.toBe("waiting_for_user");

    const second = await client.post(`/sessions/${sessionId}/answers`, {
      answer: "trying to answer a finished conversation",
    });
    record(second.raw);
    recordErrorCode(second.body);

    expect(second.status).toBe(409);
    expect(pick(second.body, ["error", "code"])).toBe("ERR_SESSION_NOT_WAITING");
  });

  test("answering a session id that never existed returns 404, not a crash", async () => {
    const client = createClient();
    const response = await client.post("/sessions/never-existed/answers", {
      answer: "hello",
    });
    record(response.raw);
    recordErrorCode(response.body);

    expect(response.status).toBe(404);
    expect(pick(response.body, ["error", "code"])).toBe("ERR_SESSION_NOT_FOUND");
  });
});

// ── 7. Results correlate correctly, and a pending run is refused ─

describe("7. GET /results, GET /results/:resultId", () => {
  test("two completed runs for two different workers each report their OWN workerId, no agentId/workflowId leak", async () => {
    const client = createClient({ requireApproval: false });

    const design = await client.post("/workers/design-engineer/tasks", {
      request: "build a new dashboard page",
      input: DESIGN_INPUT,
    });
    const product = await client.post("/workers/product-manager/tasks", {
      request: "build a new CSV export feature",
      input: { productRequest: "Let users export their history as CSV", targetUser: "CLI users" },
    });
    record(design.raw);
    record(product.raw);

    const designExecId = (design.body["session"] as Record<string, unknown>)["executionId"] as
      | string
      | undefined;
    const productExecId = (product.body["session"] as Record<string, unknown>)["executionId"] as
      | string
      | undefined;

    expect(typeof designExecId).toBe("string");
    expect(typeof productExecId).toBe("string");

    const designResult = await client.get(`/results/${designExecId}`);
    const productResult = await client.get(`/results/${productExecId}`);
    record(designResult.raw);
    record(productResult.raw);

    expect(designResult.status).toBe(200);
    expect(productResult.status).toBe(200);
    expect(pick(designResult.body, ["result", "workerId"])).toBe("design-engineer");
    expect(pick(productResult.body, ["result", "workerId"])).toBe("product-manager");

    for (const result of [designResult, productResult]) {
      const keys = Object.keys(result.body["result"] as Record<string, unknown>);
      expect(keys).not.toContain("agentId");
      expect(keys).not.toContain("workflowId");
    }

    const list = await client.get("/results");
    record(list.raw);
    const results = list.body["results"] as Record<string, unknown>[];
    for (const result of results) {
      expect(Object.keys(result)).not.toContain("agentId");
      expect(Object.keys(result)).not.toContain("workflowId");
    }
    const ids = results.map((r) => r["id"]);
    expect(ids).toContain(designExecId);
    expect(ids).toContain(productExecId);
  });

  test("a run still pending approval returns 409 'not ready', never a fabricated result", async () => {
    // requireApproval defaults to true.
    const client = createClient();

    const design = await client.post("/workers/design-engineer/tasks", {
      request: "build a new dashboard page",
      input: DESIGN_INPUT,
    });
    record(design.raw);

    const session = design.body["session"] as Record<string, unknown>;
    const executionId = session["executionId"] as string | undefined;
    expect(typeof executionId).toBe("string");

    // Confirm it is genuinely pending approval before asserting on /results.
    const status = await client.get(`/api/executions/${executionId}`);
    expect(pick(status.body, ["status", "state"])).toBe("needs_approval");

    const result = await client.get(`/results/${executionId}`);
    record(result.raw);
    recordErrorCode(result.body);

    expect(result.status).toBe(409);
    expect(pick(result.body, ["error", "code"])).toBe("ERR_WORKER_RESULT_NOT_READY");
    // Must not fabricate a result under any other key.
    expect(result.body["result"]).toBeUndefined();

    // GET /results (list) must also omit the still-pending run rather than
    // surfacing it half-built.
    const list = await client.get("/results");
    record(list.raw);
    const ids = (list.body["results"] as Record<string, unknown>[]).map((r) => r["id"]);
    expect(ids).not.toContain(executionId);
  });

  test("GET /results/:resultId with a hostile id 404s cleanly, no stack trace", async () => {
    const client = createClient();
    const response = await client.get("/results/<script>alert(1)</script>");
    record(response.raw);
    recordErrorCode(response.body);

    expect(response.status).toBe(404);
    expect(response.raw).not.toContain("at Object.");
  });
});

// ── 8. Deprecated raw execution route mapping to WorkerResult ────

describe("8. legacy /api/executions results map correctly", () => {
  test("(a) a workflow a worker DOES own is NOT marked legacy and resolves the correct workerId", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = (start.body["execution"] as Record<string, unknown>)["executionId"] as string;
    await waitForStatus(client, executionId, "ready");

    const result = await client.get(`/results/${executionId}`);
    record(result.raw);

    expect(result.status).toBe(200);
    const resultBody = result.body["result"] as Record<string, unknown>;
    expect(resultBody["workerId"]).toBe("design-engineer");
    // metadata.legacy must not be set for an owned workflow.
    const metadata = resultBody["metadata"] as Record<string, unknown> | undefined;
    expect(metadata?.["legacy"]).not.toBe(true);
  });

  test("(b) attempt to construct an unowned-workflow scenario: every registered workflow is 1:1 owned by a worker in this host", async () => {
    // This host wires exactly 4 workflows and 4 workers, each worker owning
    // exactly one workflow (see packages/workers/src/catalog/*). There is no
    // HTTP-reachable way to start an execution against a workflow id with no
    // owning worker on *this* host, so the `metadata.legacy: true` branch in
    // WorkerResultService cannot be exercised purely through
    // createApiHost()+createRouter() as configured today. Documented here
    // rather than silently skipped: this is a coverage gap in the product
    // wiring, not proof the branch works.
    const client = createClient();
    const workflows = await client.get("/api/workflows");
    const ids = (workflows.body["workflows"] as Record<string, unknown>[]).map((w) => w["workflowId"]);
    const workers = await client.get("/workers/design-engineer", );
    // Sanity: 4 workflows registered.
    expect(ids.length).toBe(4);
    expect(workers.status).toBe(200);
  });
});

// ── 9. Legacy routes still work ───────────────────────────────────

describe("9. backward compatibility of /api/workflows and /api/executions", () => {
  test("/api/workflows still 200s", async () => {
    const client = createClient();
    const response = await client.get("/api/workflows");
    record(response.raw);
    expect(response.status).toBe(200);
    expect(response.body["workflows"]).toHaveLength(4);
  });

  test("/api/executions/:id and /progress and /explain still 200 for a real run", async () => {
    const client = createClient({ requireApproval: false });
    const start = await client.post("/api/workflows/design-to-code/start", { input: DESIGN_INPUT });
    const executionId = (start.body["execution"] as Record<string, unknown>)["executionId"] as string;
    await waitForStatus(client, executionId, "ready");

    const status = await client.get(`/api/executions/${executionId}`);
    const progress = await client.get(`/api/executions/${executionId}/progress`);
    const explain = await client.get(`/api/executions/${executionId}/explain`);
    record(status.raw);
    record(progress.raw);
    record(explain.raw);

    expect(status.status).toBe(200);
    expect(progress.status).toBe(200);
    expect(explain.status).toBe(200);
  });
});

// ── 10 & 11: forbidden-string sweep and error-code inventory ─────
// These run last (bun executes describe blocks top-to-bottom within a file,
// tests inside a describe in order) so ALL_RESPONSE_BODIES / ALL_ERROR_CODES
// have collected everything the tests above produced.

describe("10. no leaked credentials / prompts / provider vocabulary in any response", () => {
  test("sweep every collected response body for forbidden strings", async () => {
    // One more pass generating fresh traffic in case describe-block ordering
    // does not guarantee prior tests ran first under a given bun version.
    const client = createClient({ requireApproval: false });
    const a = await client.get("/workers");
    const b = await client.post("/workers/design-engineer/tasks", {
      request: "build a new page",
      input: DESIGN_INPUT,
    });
    record(a.raw);
    record(b.raw);

    const forbidden = [
      "OPENROUTER_API_KEY",
      "sk-or-",
      "reasoning",
      "completion",
      "Bearer ",
      "openrouter.ai",
    ];

    expect(ALL_RESPONSE_BODIES.length).toBeGreaterThan(0);

    const offenders: { needle: string; sample: string }[] = [];
    for (const body of ALL_RESPONSE_BODIES) {
      for (const needle of forbidden) {
        if (body.includes(needle)) {
          offenders.push({ needle, sample: body.slice(0, 300) });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("11. every error response carries a stable error.code", () => {
  test("every triggered error path has a non-empty string code", async () => {
    const client = createClient({ requireApproval: false });

    // Trigger a spread of error paths directly, independent of test order,
    // and confirm each one has error.code present as a non-empty string.
    const attempts: { label: string; response: { status: number; body: Record<string, unknown> } }[] = [];

    attempts.push({ label: "unknown worker GET", response: await client.get("/workers/nobody") });
    attempts.push({
      label: "unknown worker POST tasks",
      response: await client.post("/workers/nobody/tasks", {}),
    });
    attempts.push({
      label: "unknown session GET",
      response: await client.get("/sessions/nobody"),
    });
    attempts.push({
      label: "unknown session answers POST",
      response: await client.post("/sessions/nobody/answers", { answer: "x" }),
    });
    attempts.push({
      label: "unknown result GET",
      response: await client.get("/results/nobody"),
    });
    attempts.push({
      label: "unknown workflow start",
      response: await client.post("/api/workflows/nonsense/start", {}),
    });
    attempts.push({
      label: "unknown execution GET",
      response: await client.get("/api/executions/nobody"),
    });

    for (const attempt of attempts) {
      expect(attempt.response.status).toBeGreaterThanOrEqual(400);
      const code = pick(attempt.response.body, ["error", "code"]);
      expect(typeof code).toBe("string");
      expect((code as string).length).toBeGreaterThan(0);
      recordErrorCode(attempt.response.body);
    }

    // Surface the full inventory for the report (visible in test output).
    console.log("Distinct error codes triggered:", [...ALL_ERROR_CODES].sort());
    expect(ALL_ERROR_CODES.size).toBeGreaterThan(0);
  });
});
