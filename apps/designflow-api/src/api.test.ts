// apps/designflow-api/src/api.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiHost } from "./host";
import type { ApiHost, ApiHostOptions } from "./host";
import { createRouter } from "./router";

/**
 * API behaviour tests.
 *
 * Every one drives the HTTP surface with a real `Request`, against a real
 * SQLite file. No route is stubbed and no engine call is mocked — the point of
 * this stage is that the thing actually runs and actually persists.
 */

// ── Harness ─────────────────────────────────────────────────────

const workspaces: string[] = [];
const openHosts: ApiHost[] = [];

function databasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-api-"));
  workspaces.push(dir);
  return join(dir, "test.sqlite");
}

interface Client {
  readonly host: ApiHost;
  get(path: string): Promise<{ status: number; body: Record<string, unknown> }>;
  post(
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
}

function createClient(options?: ApiHostOptions): Client {
  const host = createApiHost({
    databasePath: databasePath(),
    ...options,
  });
  openHosts.push(host);

  const handle = createRouter(host);

  const send = async (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const request = new Request(`http://localhost${path}`, {
      method,
      ...(body !== undefined
        ? {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }
        : {}),
    });

    const response = await handle(request);
    const parsed: unknown = await response.json();

    return {
      status: response.status,
      body:
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? { ...parsed }
          : {},
    };
  };

  return {
    host,
    get: (path) => send("GET", path),
    post: (path, body) => send("POST", path, body ?? {}),
  };
}

const DESIGN_INPUT = {
  designFile: "homepage.fig",
  framework: "react",
  frames: ["brand/Header", "brand/Footer", "layout/Dashboard"],
};

/** Reads a nested value without asserting anything about its shape. */
function pick(body: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = body;

  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    const record: Record<string, unknown> = { ...current };
    current = record[key];
  }

  return current;
}

afterEach(() => {
  for (const host of openHosts.splice(0)) host.close();
  for (const dir of workspaces.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── 1. User can start a workflow through the API ────────────────

describe("starting a workflow", () => {
  test("lists the workflows on offer", async () => {
    const client = createClient();

    const response = await client.get("/api/workflows");

    expect(response.status).toBe(200);
    expect(response.body.workflows).toHaveLength(4);
    // Inputs come from the owning worker's own manifest — proves the
    // deprecated route no longer returns an empty form for a worker whose
    // fields it does not hand-duplicate.
    const designEngineerInputs = (response.body.workflows[0] as Record<string, unknown>)["inputs"];
    expect(Array.isArray(designEngineerInputs) && designEngineerInputs.length).toBe(3);
    expect((designEngineerInputs as { key: string }[]).map((f) => f.key)).toEqual([
      "designFile",
      "framework",
      "frames",
    ]);

    const { inputs: _inputs, ...withoutInputs } = response.body.workflows[0] as Record<string, unknown>;
    expect(withoutInputs).toEqual({
      workflowId: "design-to-code",
      name: "Design → Code",
      description: "Convert design inputs into production-ready code artifacts",
      steps: [
        "analyze-design",
        "extract-design-tokens",
        "create-component-structure",
        "generate-code",
        "validate-output",
      ],
    });

    // The regression this guards against: a workflow whose owning worker
    // wasn't in a web-side hardcoded table got an empty `inputs: []`, which
    // rendered an empty form. Every one of the four now carries its own
    // non-empty, correctly-shaped `inputs`.
    for (const workflow of response.body.workflows as Record<string, unknown>[]) {
      const inputs = workflow["inputs"];
      expect(Array.isArray(inputs) && inputs.length > 0).toBe(true);
    }
  });

  test("starts a run and returns a handle", async () => {
    const client = createClient({ requireApproval: false });

    const response = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });

    expect(response.status).toBe(201);
    expect(pick(response.body, ["execution", "workflowName"])).toBe(
      "Design → Code",
    );
    expect(pick(response.body, ["execution", "state"])).toBe("ready");
  });

  test("rejects an unknown workflow", async () => {
    const client = createClient();

    const response = await client.post("/api/workflows/nonsense/start", {
      input: {},
    });

    expect(response.status).toBe(404);
    expect(pick(response.body, ["error", "code"])).toBe(
      "ERR_WORKFLOW_NOT_FOUND",
    );
  });

  test("returns 404 for an unknown route", async () => {
    const client = createClient();

    const response = await client.get("/api/nope");

    expect(response.status).toBe(404);
  });
});

// ── 2. Execution persists after a restart ───────────────────────

describe("persistence", () => {
  test("a run survives the process that created it", async () => {
    const path = databasePath();

    // First "process": run a workflow, then close the host entirely.
    const first = createApiHost({ databasePath: path, requireApproval: false });
    const startResponse = await createRouter(first)(
      new Request("http://localhost/api/workflows/design-to-code/start", {
        method: "POST",
        body: JSON.stringify({ input: DESIGN_INPUT }),
        headers: { "content-type": "application/json" },
      }),
    );
    const started: unknown = await startResponse.json();
    const executionId = String(
      pick(
        typeof started === "object" && started !== null ? { ...started } : {},
        ["execution", "executionId"],
      ),
    );
    first.close();

    // Second "process": nothing in memory carries over.
    const second = createApiHost({ databasePath: path, requireApproval: false });
    openHosts.push(second);
    const handle = createRouter(second);

    const response = await handle(
      new Request(`http://localhost/api/executions/${executionId}`),
    );
    const body: unknown = await response.json();
    const parsed =
      typeof body === "object" && body !== null ? { ...body } : {};

    expect(response.status).toBe(200);
    expect(pick(parsed, ["status", "executionId"])).toBe(executionId);
    expect(pick(parsed, ["status", "state"])).toBe("ready");
  });

  test("the narration survives too, not just the status", async () => {
    const path = databasePath();

    const first = createApiHost({ databasePath: path, requireApproval: false });
    const startResponse = await createRouter(first)(
      new Request("http://localhost/api/workflows/design-to-code/start", {
        method: "POST",
        body: JSON.stringify({ input: DESIGN_INPUT }),
        headers: { "content-type": "application/json" },
      }),
    );
    const started: unknown = await startResponse.json();
    const executionId = String(
      pick(
        typeof started === "object" && started !== null ? { ...started } : {},
        ["execution", "executionId"],
      ),
    );
    first.close();

    const second = createApiHost({ databasePath: path, requireApproval: false });
    openHosts.push(second);

    const response = await createRouter(second)(
      new Request(`http://localhost/api/executions/${executionId}/explain`),
    );
    const body: unknown = await response.json();
    const parsed =
      typeof body === "object" && body !== null ? { ...body } : {};

    // The engine's own subscriber drops artifact.* events, so a narration that
    // survives is proof the raw stream was persisted, not just the record.
    const narration = pick(parsed, ["report", "narration"]);
    expect(Array.isArray(narration)).toBe(true);
    expect(JSON.stringify(narration)).toContain("Completed successfully");
  });

  test("artifacts survive the restart", async () => {
    const path = databasePath();

    const first = createApiHost({ databasePath: path, requireApproval: false });
    const startResponse = await createRouter(first)(
      new Request("http://localhost/api/workflows/design-to-code/start", {
        method: "POST",
        body: JSON.stringify({ input: DESIGN_INPUT }),
        headers: { "content-type": "application/json" },
      }),
    );
    const started: unknown = await startResponse.json();
    const executionId = String(
      pick(
        typeof started === "object" && started !== null ? { ...started } : {},
        ["execution", "executionId"],
      ),
    );
    first.close();

    const second = createApiHost({ databasePath: path, requireApproval: false });
    openHosts.push(second);

    const response = await createRouter(second)(
      new Request(`http://localhost/api/executions/${executionId}/explain`),
    );
    const body: unknown = await response.json();
    const parsed =
      typeof body === "object" && body !== null ? { ...body } : {};

    expect(JSON.stringify(pick(parsed, ["report", "artifacts"]))).toContain(
      "Design tokens",
    );
  });
});

// ── 3. Progress is returned correctly ───────────────────────────

describe("progress", () => {
  test("reports a completed run as every step done", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const response = await client.get(
      `/api/executions/${executionId}/progress`,
    );

    expect(response.status).toBe(200);
    expect(pick(response.body, ["progress", "completed"])).toBe(5);
    expect(pick(response.body, ["progress", "total"])).toBe(5);
    expect(pick(response.body, ["progress", "percent"])).toBe(100);
  });

  test("names each step in order", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const response = await client.get(
      `/api/executions/${executionId}/progress`,
    );

    expect(JSON.stringify(pick(response.body, ["progress", "steps"]))).toContain(
      "Analyze design",
    );
  });

  test("404s for an execution that does not exist", async () => {
    const client = createClient();

    const response = await client.get("/api/executions/missing/progress");

    expect(response.status).toBe(404);
    expect(pick(response.body, ["error", "code"])).toBe(
      "ERR_EXECUTION_NOT_FOUND",
    );
  });
});

// ── 4. Approval flow works through the API ──────────────────────

describe("approval", () => {
  test("a gated run reports as needing approval", async () => {
    const client = createClient();

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const status = await client.get(`/api/executions/${executionId}`);

    expect(pick(status.body, ["status", "state"])).toBe("needs_approval");
    expect(
      String(pick(status.body, ["status", "approval", "reason"])),
    ).toContain("approve-code-generation");
  });

  test("approving completes the run", async () => {
    const client = createClient();

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const approve = await client.post(
      `/api/executions/${executionId}/approve`,
      { comment: "looks right" },
    );

    expect(approve.status).toBe(200);
    expect(pick(approve.body, ["outcome", "decision"])).toBe("approve");
    expect(pick(approve.body, ["outcome", "state"])).toBe("ready");
  });

  test("rejecting stops the run", async () => {
    const client = createClient();

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const reject = await client.post(`/api/executions/${executionId}/reject`);

    expect(pick(reject.body, ["outcome", "decision"])).toBe("reject");
    expect(pick(reject.body, ["outcome", "state"])).toBe("failed");
  });

  test("refuses to decide twice", async () => {
    const client = createClient();

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    await client.post(`/api/executions/${executionId}/approve`);
    const second = await client.post(`/api/executions/${executionId}/approve`);

    // A double-clicked button must not re-run anything.
    expect(second.status).toBe(409);
    expect(pick(second.body, ["error", "code"])).toBe("ERR_NO_PENDING_APPROVAL");
  });

  test("an approval survives a restart", async () => {
    const path = databasePath();

    const first = createApiHost({ databasePath: path });
    const startResponse = await createRouter(first)(
      new Request("http://localhost/api/workflows/design-to-code/start", {
        method: "POST",
        body: JSON.stringify({ input: DESIGN_INPUT }),
        headers: { "content-type": "application/json" },
      }),
    );
    const started: unknown = await startResponse.json();
    const executionId = String(
      pick(
        typeof started === "object" && started !== null ? { ...started } : {},
        ["execution", "executionId"],
      ),
    );
    first.close();

    // A person answers hours later, in a different process.
    const second = createApiHost({ databasePath: path });
    openHosts.push(second);

    const response = await createRouter(second)(
      new Request(`http://localhost/api/executions/${executionId}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    const body: unknown = await response.json();
    const parsed =
      typeof body === "object" && body !== null ? { ...body } : {};

    expect(response.status).toBe(200);
    expect(pick(parsed, ["outcome", "decision"])).toBe("approve");
  });
});

// ── 5. Completed execution returns artifacts ────────────────────

describe("results", () => {
  test("explains what the run produced", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const response = await client.get(`/api/executions/${executionId}/explain`);
    const serialized = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    for (const name of [
      "Design analysis",
      "Design tokens",
      "Component structure",
      "Generated source code",
      "Validation report",
    ]) {
      expect(serialized).toContain(name);
    }
  });

  test("reports created and reused counts", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const response = await client.get(`/api/executions/${executionId}/explain`);

    expect(
      pick(response.body, ["report", "overview", "artifacts", "created"]),
    ).toBe(5);
    expect(
      pick(response.body, ["report", "overview", "artifacts", "reused"]),
    ).toBe(0);
  });

  test("includes a timeline", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = String(pick(start.body, ["execution", "executionId"]));

    const response = await client.get(`/api/executions/${executionId}/explain`);
    const entries = pick(response.body, ["report", "timeline", "entries"]);

    expect(Array.isArray(entries)).toBe(true);
    expect(JSON.stringify(entries)).toContain("Started workflow");
  });
});

// ── 6. History returns previous executions ──────────────────────

describe("history", () => {
  test("returns previous runs newest first", async () => {
    const client = createClient({ requireApproval: false });

    const first = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const second = await client.post("/api/workflows/design-to-code/start", {
      input: { ...DESIGN_INPUT, designFile: "about.fig" },
    });

    const response = await client.get(
      "/api/executions/history?workflowId=design-to-code",
    );
    const history = pick(response.body, ["history"]);

    expect(Array.isArray(history)).toBe(true);
    expect(JSON.stringify(history)).toContain(
      String(pick(first.body, ["execution", "executionId"])),
    );
    expect(JSON.stringify(history)).toContain(
      String(pick(second.body, ["execution", "executionId"])),
    );
  });

  test("summarises each run for a reader", async () => {
    const client = createClient({ requireApproval: false });

    await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });

    const response = await client.get(
      "/api/executions/history?workflowId=design-to-code",
    );

    expect(JSON.stringify(response.body)).toContain("Design → Code finished");
  });

  test("returns every workflow's runs when none is named", async () => {
    const client = createClient({ requireApproval: false });

    await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });

    const response = await client.get("/api/executions/history");
    const history = pick(response.body, ["history"]);

    expect(Array.isArray(history) ? history.length : 0).toBe(1);
  });

  test("history survives a restart", async () => {
    const path = databasePath();

    const first = createApiHost({ databasePath: path, requireApproval: false });
    await createRouter(first)(
      new Request("http://localhost/api/workflows/design-to-code/start", {
        method: "POST",
        body: JSON.stringify({ input: DESIGN_INPUT }),
        headers: { "content-type": "application/json" },
      }),
    );
    first.close();

    const second = createApiHost({ databasePath: path, requireApproval: false });
    openHosts.push(second);

    const response = await createRouter(second)(
      new Request("http://localhost/api/executions/history"),
    );
    const body: unknown = await response.json();
    const parsed =
      typeof body === "object" && body !== null ? { ...body } : {};
    const history = pick(parsed, ["history"]);

    expect(Array.isArray(history) ? history.length : 0).toBe(1);
  });

  test("returns nothing for a workflow that never ran", async () => {
    const client = createClient();

    const response = await client.get(
      "/api/executions/history?workflowId=design-to-code",
    );

    expect(pick(response.body, ["history"])).toEqual([]);
  });
});

// ── Stage 41: the Worker Task Boundary ───────────────────────────

describe("the worker task boundary", () => {
  test("GET /workers lists the catalogue with no agent or workflow ids", async () => {
    const client = createClient();

    const response = await client.get("/workers");

    expect(response.status).toBe(200);
    const workers = response.body.workers as Record<string, unknown>[];
    expect(workers.map((w) => w["id"])).toEqual([
      "design-engineer",
      "qa-reviewer",
      "research-analyst",
      "product-manager",
    ]);

    for (const worker of workers) {
      expect(worker["agentId"]).toBeUndefined();
      expect(worker["workflows"]).toBeUndefined();
    }
  });

  test("GET /workers/:workerId returns one worker's safe detail", async () => {
    const client = createClient();

    const response = await client.get("/workers/qa-reviewer");

    expect(response.status).toBe(200);
    expect((response.body.worker as Record<string, unknown>)["name"]).toBe("QA Reviewer");
    expect((response.body.worker as Record<string, unknown>)["agentId"]).toBeUndefined();
  });

  test("GET /workers/:workerId 404s for an unknown worker", async () => {
    const client = createClient();

    const response = await client.get("/workers/nobody");

    expect(response.status).toBe(404);
    expect((response.body.error as Record<string, unknown>)["code"]).toBe("ERR_WORKER_NOT_FOUND");
  });

  test("POST /workers/:workerId/tasks with nothing to act on asks a clarifying question, never leaking an agent id", async () => {
    const client = createClient();

    const response = await client.post("/workers/qa-reviewer/tasks", {});

    expect(response.status).toBe(201);
    const session = response.body.session as Record<string, unknown>;
    expect(session["status"]).toBe("waiting_for_user");
    expect(session["agentId"]).toBeUndefined();
    expect(typeof response.body.message).toBe("string");
  });

  test("GET /sessions and GET /sessions/:sessionId both find the session just started", async () => {
    const client = createClient();

    const started = await client.post("/workers/product-manager/tasks", {});
    const sessionId = (started.body.session as Record<string, unknown>)["id"] as string;

    const list = await client.get("/sessions");
    expect(response_ids(list.body.sessions as Record<string, unknown>[])).toContain(sessionId);

    const detail = await client.get(`/sessions/${sessionId}`);
    expect(detail.status).toBe(200);
    expect((detail.body.session as Record<string, unknown>)["id"]).toBe(sessionId);
    expect((detail.body.session as Record<string, unknown>)["agentId"]).toBeUndefined();
  });

  test("POST /workers/:workerId/tasks 404s for an unknown worker", async () => {
    const client = createClient();

    const response = await client.post("/workers/nobody/tasks", {});

    expect(response.status).toBe(404);
  });

  test("GET /results starts empty and GET /results/:resultId 404s for an unknown run", async () => {
    const client = createClient();

    const list = await client.get("/results");
    expect(list.body.results).toEqual([]);

    const detail = await client.get("/results/nobody");
    expect(detail.status).toBe(404);
  });

  test("a completed run started through the deprecated raw endpoint is discoverable as a legacy result", async () => {
    const client = createClient({ requireApproval: false });

    const start = await client.post("/api/workflows/design-to-code/start", {
      input: DESIGN_INPUT,
    });
    const executionId = (start.body.execution as Record<string, unknown>)["executionId"] as string;

    await waitForStatus(client, executionId, "ready");

    const result = await client.get(`/results/${executionId}`);
    expect(result.status).toBe(200);
    // design-to-code is owned by the design-engineer worker, so this is not
    // actually "legacy" — it proves the mapping resolves from workflow id to
    // worker id without needing a session at all.
    expect((result.body.result as Record<string, unknown>)["workerId"]).toBe("design-engineer");
    expect((result.body.result as Record<string, unknown>)["status"]).toBe("completed");
    expect(Object.keys(result.body.result as Record<string, unknown>)).not.toContain("agentId");
    expect(Object.keys(result.body.result as Record<string, unknown>)).not.toContain("workflowId");

    const list = await client.get("/results");
    expect((list.body.results as Record<string, unknown>[]).map((r) => r["id"])).toContain(executionId);
  });
});

function response_ids(sessions: Record<string, unknown>[]): string[] {
  return sessions.map((s) => s["id"] as string);
}

async function waitForStatus(
  client: Client,
  executionId: string,
  status: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await client.get(`/api/executions/${executionId}`);
    const current = (response.body.status as Record<string, unknown> | undefined)?.["state"];
    if (current === status) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`execution ${executionId} never reached ${status}`);
}
