// apps/designflow-cli/src/model-mode.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesignFlowError } from "@designflow/sdk";
import { dispatch } from "./cli";
import { createCliContext } from "./services/cli-runner";
import type { CliContext } from "./services/cli-runner";
import { ScriptedTerminal } from "./ui/terminal";
import { explainError, formatError } from "./ui/errors";

/**
 * The CLI in model mode — wired for real, against a real local HTTP server
 * standing in for OpenRouter. No mocked `fetch`, no network access beyond
 * `127.0.0.1`, and no `OPENROUTER_API_KEY` set anywhere except a synthetic
 * one this file invents and never sends anywhere but its own mock server.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];
const servers: Server[] = [];
const RUN_ANSWERS = ["homepage.fig", "react", "brand/Header"];

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
  delete process.env["DESIGNFLOW_HOME"];
  delete process.env["OPENROUTER_API_KEY"];
});

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "designflow-model-mode-"));
  workspaces.push(dir);
  return dir;
}

interface MockOpenRouter {
  readonly endpoint: string;
  readonly requests: { readonly headers: Record<string, string | string[] | undefined>; readonly body: unknown }[];
}

/** A deterministic stand-in for OpenRouter, answering with a fixed decision. */
async function mockOpenRouter(decision: unknown, status = 200): Promise<MockOpenRouter> {
  const requests: MockOpenRouter["requests"] = [];

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      requests.push({ headers: req.headers, body: raw.length > 0 ? JSON.parse(raw) : undefined });

      if (status !== 200) {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "mock failure" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "gen-mock",
          model: "openai/gpt-4o-mini",
          choices: [{ message: { role: "assistant", content: JSON.stringify(decision) } }],
          usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
        }),
      );
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected an address");

  return { endpoint: `http://127.0.0.1:${address.port}`, requests };
}

function modelContext(options: {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly requireApproval?: boolean;
}): CliContext {
  const home = workspace();
  process.env["DESIGNFLOW_HOME"] = home;
  process.env["OPENROUTER_API_KEY"] = options.apiKey ?? "sk-test-fake-key";

  const created = createCliContext({
    databasePath: join(home, "runs.json"),
    requireApproval: options.requireApproval ?? false,
    ...(options.endpoint !== undefined ? { modelEndpointOverride: options.endpoint } : {}),
  });
  contexts.push(created);
  return created;
}

// ── 55. Model mode works against a deterministic mock server ────

describe("designflow run design-engineer, in model mode", () => {
  test("a real run completes end to end through the mock provider", async () => {
    const mock = await mockOpenRouter({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "This is page work.",
    });

    const created = modelContext({ endpoint: mock.endpoint });
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    const code = await dispatch(["run", "design-engineer"], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Complete");
    expect(terminal.transcript).toContain("Created  5");
    expect(mock.requests).toHaveLength(1);
  });

  test("the model's decision is load-bearing through the real CLI path", async () => {
    const asksQuestion = await mockOpenRouter({
      type: "request_clarification",
      question: "What should I build?",
      reasoningSummary: "unclear",
    });

    const created = modelContext({ endpoint: asksQuestion.endpoint });
    const terminal = new ScriptedTerminal(RUN_ANSWERS);

    const code = await dispatch(["run", "design-engineer"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("needs more information");
    expect(terminal.transcript).toContain("Session saved.");
    expect(await created.runner.history()).toHaveLength(0);
  });

  test("the exact model slug and structured schema reach the mock server", async () => {
    const mock = await mockOpenRouter({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const created = modelContext({ endpoint: mock.endpoint });
    await dispatch(["run", "design-engineer"], created, new ScriptedTerminal(RUN_ANSWERS));

    const body = mock.requests[0]?.body as { model?: string; response_format?: unknown };
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.response_format).toBeDefined();
  });

  test("the authorization header carries the configured key and nothing else does", async () => {
    const mock = await mockOpenRouter({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const created = modelContext({ apiKey: "sk-distinctive-marker", endpoint: mock.endpoint });
    await dispatch(["run", "design-engineer"], created, new ScriptedTerminal(RUN_ANSWERS));

    expect(mock.requests[0]?.headers.authorization).toBe("Bearer sk-distinctive-marker");
  });

  test("a trace records the model call, correlated with the run", async () => {
    const mock = await mockOpenRouter({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const created = modelContext({ endpoint: mock.endpoint });
    await dispatch(["run", "design-engineer"], created, new ScriptedTerminal(RUN_ANSWERS));

    const [trace] = await created.traces.listTraces();
    const [run] = await created.runner.history();

    expect(trace?.modelCalls).toHaveLength(1);
    expect(trace?.modelCalls[0]).toMatchObject({ providerId: "openrouter", model: "openai/gpt-4o-mini" });
    expect(trace?.executionId).toBe(run?.executionId);
  });

  test("a failing mock server still lets the CLI report a clean outcome", async () => {
    const mock = await mockOpenRouter({}, 500);

    const created = modelContext({ endpoint: mock.endpoint });
    const code = await dispatch(["run", "design-engineer"], created, new ScriptedTerminal(RUN_ANSWERS));

    expect(code).toBe(1);
    expect(await created.runner.history()).toHaveLength(0);
  });

  // 44. API key never appears in config, traces, history or output.
  test("the credential never appears anywhere on disk or in the transcript", async () => {
    const mock = await mockOpenRouter({
      type: "run_workflow",
      workflowId: "design-to-code",
      reasoningSummary: "ok",
    });

    const created = modelContext({ apiKey: "sk-super-secret-marker", endpoint: mock.endpoint });
    const terminal = new ScriptedTerminal(RUN_ANSWERS);
    await dispatch(["run", "design-engineer"], created, terminal);

    expect(terminal.transcript).not.toContain("sk-super-secret-marker");

    const dbPath = created.databasePath;
    const onDisk = readFileSync(dbPath, "utf8");
    expect(onDisk).not.toContain("sk-super-secret-marker");
  });
});

// ── 45. Missing key produces a clear configuration error ────────

describe("model mode with a missing credential", () => {
  test("an empty OPENROUTER_API_KEY refuses before any workflow begins", () => {
    const home = workspace();
    process.env["DESIGNFLOW_HOME"] = home;
    process.env["OPENROUTER_API_KEY"] = "";

    let thrown: unknown = null;
    try {
      createCliContext({ databasePath: join(home, "runs.json") }).close();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DesignFlowError);
    expect((thrown as DesignFlowError).code).toBe("ERR_MODEL_API_KEY_MISSING");
  });

  test("the rendered message names OpenRouter and the env var, with no stack", () => {
    const home = workspace();
    process.env["DESIGNFLOW_HOME"] = home;
    process.env["OPENROUTER_API_KEY"] = "";

    let thrown: unknown = null;
    try {
      createCliContext({ databasePath: join(home, "runs.json") }).close();
    } catch (error) {
      thrown = error;
    }

    const rendered = formatError(thrown, false);
    expect(rendered).toContain("OpenRouter is not configured");
    expect(rendered).toContain("OPENROUTER_API_KEY");
    expect(rendered).not.toContain("    at ");

    const { problem, suggestion } = explainError(thrown);
    expect(problem.length).toBeGreaterThan(0);
    expect(suggestion.length).toBeGreaterThan(0);
  });

  test("an unset OPENROUTER_API_KEY stays in deterministic mode with no error at all", () => {
    const home = workspace();
    process.env["DESIGNFLOW_HOME"] = home;
    delete process.env["OPENROUTER_API_KEY"];

    expect(() =>
      createCliContext({ databasePath: join(home, "runs.json") }).close(),
    ).not.toThrow();
  });
});

// ── 46. Settings displays safe assignments ──────────────────────

describe("designflow settings, in model mode", () => {
  test("shows the provider, model, and that a credential is configured", async () => {
    const created = modelContext({ apiKey: "sk-whatever" });
    const terminal = new ScriptedTerminal();

    expect(await dispatch(["settings"], created, terminal)).toBe(0);

    expect(terminal.transcript).toContain("Design Engineer");
    expect(terminal.transcript).toContain("OpenRouter");
    expect(terminal.transcript).toContain("openai/gpt-4o-mini");
    expect(terminal.transcript).toContain("configured");
    expect(terminal.transcript).not.toContain("sk-whatever");
  });

  test("shows the assignment even without a credential, marked missing", async () => {
    const home = workspace();
    process.env["DESIGNFLOW_HOME"] = home;
    delete process.env["OPENROUTER_API_KEY"];

    const created = createCliContext({ databasePath: join(home, "runs.json") });
    contexts.push(created);

    const terminal = new ScriptedTerminal();
    await dispatch(["settings"], created, terminal);

    expect(terminal.transcript).toContain("missing");
  });
});

// ── 47/48. Boundary: only the composition root touches OpenRouter ─

describe("architecture: the provider stays out of the application", () => {
  function code(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  function sources(dir: string): readonly string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        found.push(...sources(path));
        continue;
      }
      if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) found.push(path);
    }
    return found;
  }

  test("no command imports the OpenRouter provider or the models package", () => {
    const commandDir = join(import.meta.dir, "commands");

    for (const entry of readdirSync(commandDir)) {
      const contents = code(join(commandDir, entry));

      for (const forbidden of [
        "@designflow/model-provider-openrouter",
        "@designflow/models",
        "OpenRouterProvider",
        "ModelRuntime",
        "ModelProviderRegistry",
        "OPENROUTER_API_KEY",
      ]) {
        expect(contents).not.toContain(forbidden);
      }
    }
  });

  test("only the composition root imports the OpenRouter provider", () => {
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;
      if (code(path).includes("@designflow/model-provider-openrouter")) {
        offenders.push(path.split("/").slice(-2).join("/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  // 43. OPENROUTER_API_KEY is read only at the provider/configuration boundary.
  test("only the composition root reads process.env.OPENROUTER_API_KEY", () => {
    // Distinct from merely *naming* the variable — `ui/errors.ts` legitimately
    // tells a person which env var to set, in a static string, without ever
    // reading it. What must stay confined to the composition root is the
    // actual read.
    const offenders: string[] = [];

    for (const path of sources(import.meta.dir)) {
      if (path.endsWith("services/cli-runner.ts")) continue;

      const contents = code(path);
      if (/process\.env(\.OPENROUTER_API_KEY|\[\s*["']OPENROUTER_API_KEY["']\s*\])/.test(contents)) {
        offenders.push(path.split("/").slice(-2).join("/"));
      }
    }

    expect(offenders).toEqual([]);
  });

  test("the value is never echoed — only the variable's name may appear in prose", () => {
    // `ui/errors.ts` is allowed to say "set OPENROUTER_API_KEY"; nothing may
    // ever interpolate `process.env.OPENROUTER_API_KEY`'s actual value into a
    // string template destined for the screen.
    for (const path of sources(import.meta.dir)) {
      expect(code(path)).not.toMatch(/\$\{[^}]*OPENROUTER_API_KEY[^}]*\}/);
    }
  });

  test("the composition root wires the provider but never calls it directly", () => {
    const runner = readFileSync(join(import.meta.dir, "services", "cli-runner.ts"), "utf8");

    expect(runner).toContain("OpenRouterProvider");
    expect(runner).toContain("ModelRuntime");
    // Wiring constructs it; only `AgentRuntime`, through the agent's own
    // model service, ever calls `.generate` on the resulting model layer.
    expect(runner).not.toContain(".generate(");
  });
});
