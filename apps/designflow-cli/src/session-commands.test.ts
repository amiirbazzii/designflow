// apps/designflow-cli/src/session-commands.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import {
  createServer,
  type Server,
} from "node:http";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "./cli";
import {
  createCliContext,
  type CliContext,
} from "./services/cli-runner";

import {
  ScriptedTerminal,
  type Terminal,
} from "./ui/terminal";

import { explainError } from "./ui/errors";
import { answerSessionRequestSchema, DesignFlowError } from "@designflow/sdk";
import { SESSION_ERROR_CODES } from "@designflow/product";

/**
 * Reproduces `main.ts`'s `pipedTerminal`: once its queued answers run out,
 * `ask` returns an empty string rather than throwing. `ScriptedTerminal`
 * throws on exhaustion instead — the right stand-in for an interactive
 * `Ctrl+C`, but it cannot exercise what a piped, non-TTY run of the real
 * binary actually does when a script's input runs short.
 */
class EmptyOnExhaustionTerminal implements Terminal {
  public readonly output: string[] = [];
  private readonly answers: string[];

  public constructor(answers: readonly string[] = []) {
    this.answers = [...answers];
  }

  public print(line = ""): void {
    this.output.push(line);
  }

  public async ask(): Promise<string> {
    return this.answers.shift() ?? "";
  }

  public get transcript(): string {
    return this.output.join("\n");
  }
}

/**
 * `designflow sessions`, `designflow answer` and `designflow cancel`.
 *
 * A resumable clarification, driven the way a person would: start a run that
 * needs more detail, let it fall back to a saved session (the terminal runs
 * out of scripted answers, the same stand-in for `Ctrl+C` the `run` tests
 * use), then find, answer and cancel that session as a second, later command.
 */

const workspaces: string[] = [];
const contexts: CliContext[] = [];
const servers: Server[] = [];

function flatDecision(decision: unknown): unknown {
  if (typeof decision !== "object" || decision === null || !("type" in decision)) return decision;
  const record = decision as Record<string, unknown>;
  return {
    ...record,
    workflowId: record.workflowId ?? null,
    question: record.question ?? null,
    reason: record.reason ?? null,
  };
}

/** Answers OpenRouter requests one decision at a time, in the order given. */
async function mockOpenRouterSequence(decisions: readonly unknown[]): Promise<string> {
  let index = 0;

  const server = createServer((req, res) => {
    req.on("data", () => {
      // Request body is not needed by this mock — it always answers with
      // the next scripted decision regardless of what was asked.
    });
    req.on("end", () => {
      const decision = decisions[Math.min(index, decisions.length - 1)];
      index += 1;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "gen-mock",
          model: "openai/gpt-4o-mini",
          choices: [{ message: { role: "assistant", content: JSON.stringify(flatDecision(decision)) } }],
          usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
        }),
      );
    });
  });

  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected an address");

  return `http://127.0.0.1:${address.port}`;
}

function modelContext(endpoint: string, options?: { readonly requireApproval?: boolean }): CliContext {
  const dir = mkdtempSync(join(tmpdir(), "designflow-sessions-model-"));
  workspaces.push(dir);
  process.env.DESIGNFLOW_HOME = dir;
  process.env.OPENROUTER_API_KEY = "sk-test-fake-key";

  const created = createCliContext({
    databasePath: join(dir, "runs.json"),
    requireApproval: options?.requireApproval ?? false,
    modelEndpointOverride: endpoint,
  });
  contexts.push(created);
  return created;
}

function context(): CliContext {
  const dir = mkdtempSync(join(tmpdir(), "designflow-sessions-"));
  workspaces.push(dir);
  process.env.DESIGNFLOW_HOME = dir;

  const created = createCliContext({ databasePath: join(dir, "runs.json") });
  contexts.push(created);

  created.workers.registerWorker({
    id: "quiet-worker",
    name: "Quiet Worker",
    description: "Collects no input",
    category: "testing",
    workflows: ["design-to-code"],
    inputs: [],
    agentId: "design-engineer-agent",
  });

  return created;
}

/** Runs a worker until its session is left `waiting_for_user`, and returns the session id. */
async function startWaitingSession(created: CliContext): Promise<string> {
  const terminal = new ScriptedTerminal();
  const code = await dispatch(["run", "quiet-worker"], created, terminal);
  expect(code).toBe(1);

  const match = terminal.transcript.match(/designflow answer ([a-f0-9-]+)/);
  const sessionId = match?.[1];
  if (sessionId === undefined) throw new Error("no session id in transcript");
  return sessionId;
}

afterEach(() => {
  for (const created of contexts.splice(0)) created.close();
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
  delete process.env.DESIGNFLOW_HOME;
  delete process.env.OPENROUTER_API_KEY;
});

describe("piped stdin running out mid-clarification", () => {
  test("`run` saves the session instead of crashing on an empty answer", async () => {
    const created = context();

    // `EmptyOnExhaustionTerminal` supplies the three form-field answers and
    // then returns "" for the clarification prompt — exactly what a real
    // `printf '...' | designflow run quiet-worker` does once its piped input
    // is exhausted.
    const terminal = new EmptyOnExhaustionTerminal();
    const code = await dispatch(["run", "quiet-worker"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("Session saved.");
    expect(terminal.transcript).not.toContain("ZodError");
    expect(terminal.transcript).not.toContain("too_small");
  });

  test("`answer` reports a safe message instead of crashing on an empty answer", async () => {
    const created = context();
    const sessionId = await startWaitingSession(created);

    const terminal = new EmptyOnExhaustionTerminal();
    const code = await dispatch(["answer", sessionId], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No answer was given");
    expect(terminal.transcript).not.toContain("ZodError");
    expect(terminal.transcript).not.toContain("too_small");

    // The session is genuinely unchanged — still resumable.
    const session = await created.sessions.getSession(sessionId);
    expect(session.status).toBe("waiting_for_user");
  });
});

describe("designflow sessions", () => {
  test("lists a session waiting for an answer", async () => {
    const created = context();
    const sessionId = await startWaitingSession(created);

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["sessions"], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Waiting for you");
    expect(terminal.transcript).toContain("Quiet Worker");
    expect(terminal.transcript).toContain(sessionId);

    // No internal ids reach the transcript.
    expect(terminal.transcript).not.toContain("design-engineer-agent");
  });

  test("shows nothing waiting when there is nothing waiting", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();
    const code = await dispatch(["sessions"], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Nothing is waiting on you");
  });

  test("shows a single session's detail by id", async () => {
    const created = context();
    const sessionId = await startWaitingSession(created);

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["sessions", sessionId], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Quiet Worker");
    expect(terminal.transcript).toContain(sessionId);
  });

  test("reports an unknown session id safely", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();
    const code = await dispatch(["sessions", "nope"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No session with that id");
  });

  test("filters by --status", async () => {
    const created = context();
    await startWaitingSession(created);

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["sessions", "--status", "completed"], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("No sessions with that status");
  });
});

describe("designflow answer", () => {
  test("resumes the same session, same worker and agent, to completion", async () => {
    // The deterministic strategy classifies the *original* request and input
    // only, so it can never resolve a clarification on its own — a scripted
    // model, one decision per call, is what actually exercises "the second
    // decision is a new bounded call, not the agent looping on its own".
    const endpoint = await mockOpenRouterSequence([
      {
        type: "request_clarification",
        question: "Which component?",
        reasoningSummary: "Ambiguous request.",
      },
      {
        type: "run_workflow",
        workflowId: "qa-review",
        reasoningSummary: "The answer named a review target.",
      },
    ]);
    const created = modelContext(endpoint);

    // One field, so `hasSomethingToDo` is true and the mock model is actually
    // consulted on both turns — a worker collecting nothing short-circuits to
    // a fixed clarification before either strategy reaches the model at all,
    // which would make the mocked decisions below beside the point.
    // MVP-3B: the Design Engineer's model strategy no longer consults a
    // model at all, so the two-turn mocked exchange is exercised through the
    // QA Reviewer's still-model-backed coordinator instead.
    created.workers.registerWorker({
      id: "quiet-worker",
      name: "Quiet Worker",
      description: "Collects a review target",
      category: "testing",
      workflows: ["qa-review"],
      inputs: [{ key: "target", label: "Review target", placeholder: "src/components/Header.tsx" }],
      agentId: "qa-reviewer-agent",
    });

    const startTranscript = new ScriptedTerminal(["src/components/Header.tsx"]);
    const startCode = await dispatch(["run", "quiet-worker"], created, startTranscript);
    expect(startCode).toBe(1);

    const match = startTranscript.transcript.match(/designflow answer ([a-f0-9-]+)/);
    const sessionId = match?.[1];
    if (sessionId === undefined) throw new Error("no session id in transcript");

    const terminal = new ScriptedTerminal(["review the header for accessibility"]);
    const code = await dispatch(["answer", sessionId], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Quiet Worker needs more information");
    expect(terminal.transcript).toContain("Complete");

    const session = await created.sessions.getSession(sessionId);
    expect(session.status).toBe("completed");
    expect(session.executionId).toBeDefined();
  });

  test("an unknown session id is reported safely", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();
    const code = await dispatch(["answer", "nope"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No session with that id");
  });

  test("a session that is not waiting refuses the answer", async () => {
    const created = context();
    const sessionId = await startWaitingSession(created);
    await created.sessions.cancelSession({ sessionId });

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["answer", sessionId], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("not waiting for an answer");
  });

  test("without a session id, explains what to type", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();
    const code = await dispatch(["answer"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("designflow answer <session-id>");
  });
});

describe("designflow cancel", () => {
  test("cancels a waiting session", async () => {
    const created = context();
    const sessionId = await startWaitingSession(created);

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["cancel", sessionId], created, terminal);

    expect(code).toBe(0);
    expect(terminal.transcript).toContain("Session cancelled");

    const session = await created.sessions.getSession(sessionId);
    expect(session.status).toBe("cancelled");
  });

  test("cancelling twice is refused, not silently accepted", async () => {
    const created = context();
    const sessionId = await startWaitingSession(created);
    await dispatch(["cancel", sessionId], created, new ScriptedTerminal());

    const terminal = new ScriptedTerminal();
    const code = await dispatch(["cancel", sessionId], created, terminal);

    expect(code).toBe(1);
  });

  test("an unknown session id is reported safely", async () => {
    const created = context();
    const terminal = new ScriptedTerminal();
    const code = await dispatch(["cancel", "nope"], created, terminal);

    expect(code).toBe(1);
    expect(terminal.transcript).toContain("No session with that id");
  });
});

describe("session error codes", () => {
  test("every code the session layer publishes is mapped", () => {
    expect(SESSION_ERROR_CODES.length).toBeGreaterThan(5);

    const unmapped = SESSION_ERROR_CODES.filter((code) => {
      const explained = explainError(new DesignFlowError(code, "raw internal text"));
      return explained.suggestion.includes("designflow --help");
    });

    expect(unmapped).toEqual([]);
  });

  test("every session code says whether anything started", () => {
    // `ERR_SESSION_NOT_FOUND` is a lookup failure, not an action refused —
    // the same standard `ERR_WORKER_NOT_FOUND` is held to elsewhere: it
    // names what to do next rather than what did or didn't start.
    const actionCodes = SESSION_ERROR_CODES.filter((code) => code !== "ERR_SESSION_NOT_FOUND");

    const silent = actionCodes.filter((code) => {
      const { problem, suggestion } = explainError(
        new DesignFlowError(code, "raw internal text"),
      );
      return !/nothing was started|nothing was written|has already/i.test(
        `${problem} ${suggestion}`,
      );
    });

    expect(silent).toEqual([]);
  });

  test("no session code leaks internal vocabulary", () => {
    for (const code of SESSION_ERROR_CODES) {
      const { problem, suggestion } = explainError(
        new DesignFlowError(code, "Agent design-engineer-agent may not call workflow design-to-code"),
      );
      const shown = `${problem} ${suggestion}`.toLowerCase();

      for (const leak of ["agent", "workflow", "design-to-code", "model profile"]) {
        expect(shown).not.toContain(leak);
      }
    }
  });

  test("a raw ZodError — e.g. answerSessionRequestSchema rejecting an empty answer — is never shown raw", () => {
    const validation = answerSessionRequestSchema.safeParse({ sessionId: "s1", answer: "" });
    expect(validation.success).toBe(false);
    if (validation.success) return;

    const { problem, suggestion } = explainError(validation.error);
    const shown = `${problem} ${suggestion}`;

    expect(shown).not.toContain("ZodError");
    expect(shown).not.toContain("too_small");
    expect(shown).not.toContain('"code"');
    expect(shown).not.toContain("issues");
  });
});
