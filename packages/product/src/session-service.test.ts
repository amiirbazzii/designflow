// packages/product/src/session-service.test.ts
import { describe, expect, test } from "bun:test";
import { DesignFlowError, workerManifestSchema } from "@designflow/sdk";
import type {
  AgentDecision,
  AgentDecisionService,
  AgentExecutionResult,
  AgentTask,
  SessionEvent,
  SessionObserver,
  WorkerManifest,
  WorkerRegistry,
} from "@designflow/sdk";
import { WorkerTaskRouter } from "./worker-task";
import { InMemorySessionStore } from "./session-store";
import { AgentSessionService } from "./session-service";
import type { SessionClock, SessionWorkflowStarter } from "./session-service";
import type { ExecutionHandle, WorkflowLaunchRequest } from "./schemas";

/**
 * The Session Orchestrator.
 *
 * These tests exercise the clarification loop end to end against in-memory
 * doubles: a scripted agent, an in-memory session store, and a workflow
 * starter that just remembers what it was asked to run. What is under test
 * is the orchestration — turn counting, the state machine, concurrency,
 * expiration, context building — not any concrete storage or execution
 * engine, which are exercised elsewhere.
 */

// ── Harness ─────────────────────────────────────────────────────

function worker(overrides: Partial<WorkerManifest> = {}): WorkerManifest {
  return workerManifestSchema.parse({
    id: "design-engineer",
    name: "Design Engineer",
    description: "Builds things",
    category: "testing",
    workflows: ["design-to-code"],
    agentId: "design-engineer-agent",
    ...overrides,
  });
}

function registry(workers: readonly WorkerManifest[]): WorkerRegistry {
  return {
    listWorkers: () => workers,
    getWorker: (id) => workers.find((candidate) => candidate.id === id),
    registerWorker: () => {
      throw new Error("not used");
    },
  };
}

/** An agent whose decisions are scripted turn by turn, and records every task it saw. */
function scriptedAgent(
  decisions: readonly AgentDecision[],
  seenTasks: AgentTask[] = [],
): AgentDecisionService {
  let index = 0;
  return {
    decide: (task): Promise<AgentExecutionResult> => {
      seenTasks.push(task);
      const decision = decisions[Math.min(index, decisions.length - 1)];
      index += 1;
      return Promise.resolve({
        agentId: task.agentId,
        workerId: task.workerId,
        decision: decision as AgentDecision,
        traceId: `trace-${index}`,
      });
    },
  };
}

function starter(): SessionWorkflowStarter & { started: WorkflowLaunchRequest[] } {
  const started: WorkflowLaunchRequest[] = [];
  return {
    started,
    start: async (request): Promise<ExecutionHandle> => {
      started.push(request);
      return {
        executionId: `exec-${started.length}`,
        workflowId: request.workflowId,
        workflowName: request.workflowId,
        state: "ready",
      };
    },
  };
}

function clock(...timestamps: string[]): SessionClock {
  let index = 0;
  return {
    now: () => {
      const value = timestamps[Math.min(index, timestamps.length - 1)];
      index += 1;
      return value ?? "2026-08-01T10:00:00.000Z";
    },
  };
}

function harness(options?: {
  readonly decisions?: readonly AgentDecision[];
  readonly workers?: readonly WorkerManifest[];
  readonly clock?: SessionClock;
  readonly maxClarificationTurns?: number;
  readonly expirationDays?: number;
  readonly observer?: SessionObserver;
  readonly seenTasks?: AgentTask[];
}) {
  const workers = registry(options?.workers ?? [worker()]);
  const agent = scriptedAgent(
    options?.decisions ?? [{ type: "decline", reason: "nothing to do" }],
    options?.seenTasks,
  );
  const router = new WorkerTaskRouter({ workers, agents: agent });
  const store = new InMemorySessionStore();
  const runner = starter();

  let idCounter = 0;

  const service = new AgentSessionService({
    store,
    workers,
    router,
    runner,
    ...(options?.clock !== undefined ? { clock: options.clock } : {}),
    ...(options?.maxClarificationTurns !== undefined
      ? { maxClarificationTurns: options.maxClarificationTurns }
      : {}),
    ...(options?.expirationDays !== undefined ? { expirationDays: options.expirationDays } : {}),
    ...(options?.observer !== undefined ? { observer: options.observer } : {}),
    generateId: () => {
      idCounter += 1;
      return `session-${idCounter}`;
    },
  });

  return { service, store, runner };
}

const expectCode = async (operation: Promise<unknown>, code: string): Promise<void> => {
  try {
    await operation;
    throw new Error(`Expected rejection with ${code}`);
  } catch (error) {
    if (!(error instanceof DesignFlowError)) throw error;
    expect(error.code).toBe(code);
  }
};

// ── 14-16. First clarification, resume, same worker/agent ───────

describe("the clarification loop", () => {
  test("a request_clarification decision creates a waiting session", async () => {
    const { service } = harness({
      decisions: [{ type: "request_clarification", question: "Which component?" }],
    });

    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    expect(result.session.status).toBe("waiting_for_user");
    expect(result.session.turnCount).toBe(1);
    expect(result.message).toBe("Which component?");
  });

  test("answering resumes the same session id, worker and agent", async () => {
    const seenTasks: AgentTask[] = [];
    const { service } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "run_workflow", workflowId: "design-to-code" },
      ],
      seenTasks,
    });

    const started = await service.startSession({ workerId: "design-engineer", request: "help" });
    const resumed = await service.answerSession({
      sessionId: started.session.id,
      answer: "the header",
    });

    expect(resumed.session.id).toBe(started.session.id);
    expect(resumed.session.status).toBe("completed");
    expect(seenTasks).toHaveLength(2);
    expect(seenTasks[0]?.agentId).toBe("design-engineer-agent");
    expect(seenTasks[1]?.agentId).toBe("design-engineer-agent");
  });

  test("a second clarification increments the turn count", async () => {
    const { service } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "request_clarification", question: "What color?" },
      ],
    });

    const started = await service.startSession({ workerId: "design-engineer", request: "help" });
    const resumed = await service.answerSession({
      sessionId: started.session.id,
      answer: "the header",
    });

    expect(resumed.session.turnCount).toBe(2);
    expect(resumed.session.status).toBe("waiting_for_user");
    expect(resumed.session.answers).toHaveLength(1);
  });

  test("a run_workflow decision starts exactly one workflow and records the execution id", async () => {
    const { service, runner } = harness({
      decisions: [{ type: "run_workflow", workflowId: "design-to-code" }],
    });

    const result = await service.startSession({ workerId: "design-engineer", request: "build it" });

    expect(runner.started).toHaveLength(1);
    expect(result.session.status).toBe("completed");
    expect(result.session.executionId).toBe("exec-1");
  });

  test("a decline closes the session without starting a workflow", async () => {
    const { service, runner } = harness({
      decisions: [{ type: "decline", reason: "not possible" }],
    });

    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    expect(runner.started).toHaveLength(0);
    expect(result.session.status).toBe("declined");
    expect(result.session.declineReason).toBe("not possible");
    expect(result.message).toBe("not possible");
  });

  test("a clarification starts no execution record", async () => {
    const { service, runner } = harness({
      decisions: [{ type: "request_clarification", question: "Which component?" }],
    });

    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    expect(runner.started).toHaveLength(0);
    expect(result.session.executionId).toBeUndefined();
  });

  test("the existing per-agent model profile is preserved on the session", async () => {
    const { store } = harness({});
    const service = new AgentSessionService({
      store,
      workers: registry([worker()]),
      router: new WorkerTaskRouter({
        workers: registry([worker()]),
        agents: scriptedAgent([{ type: "decline", reason: "no" }]),
      }),
      runner: starter(),
      resolveModelProfileId: (agentId) => (agentId === "design-engineer-agent" ? "de-profile" : undefined),
    });

    const result = await service.startSession({ workerId: "design-engineer", request: "help" });
    expect(result.session.modelProfileId).toBe("de-profile");
  });
});

// ── 8-13. State machine ────────────────────────────────────────

describe("the session state machine", () => {
  test("only waiting_for_user sessions accept answers", async () => {
    const { service } = harness({ decisions: [{ type: "decline", reason: "no" }] });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "anything" }),
      "ERR_SESSION_NOT_WAITING",
    );
  });

  test("a completed session cannot resume", async () => {
    const { service } = harness({
      decisions: [{ type: "run_workflow", workflowId: "design-to-code" }],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "x" }),
      "ERR_SESSION_NOT_WAITING",
    );
  });

  test("a cancelled session cannot resume, with its own error code", async () => {
    const { service } = harness({
      decisions: [{ type: "request_clarification", question: "Which component?" }],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });
    await service.cancelSession({ sessionId: result.session.id });

    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "x" }),
      "ERR_SESSION_CANCELLED",
    );
  });

  test("an expired session cannot resume", async () => {
    const testClock = clock("2026-08-01T10:00:00.000Z");
    const { service } = harness({
      decisions: [{ type: "request_clarification", question: "Which component?" }],
      clock: testClock,
      expirationDays: 0,
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    // Expiry was computed from the same moment the session was created, and
    // `expirationDays: 0` puts `expiresAt` at that same instant.
    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "x" }),
      "ERR_SESSION_EXPIRED",
    );
  });

  test("waiting_for_user may be cancelled", async () => {
    const { service } = harness({
      decisions: [{ type: "request_clarification", question: "Which component?" }],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    const cancelled = await service.cancelSession({ sessionId: result.session.id });
    expect(cancelled.status).toBe("cancelled");
  });

  test("a cancelled session cannot be cancelled again", async () => {
    const { service } = harness({
      decisions: [{ type: "request_clarification", question: "Which component?" }],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });
    await service.cancelSession({ sessionId: result.session.id });

    await expectCode(
      service.cancelSession({ sessionId: result.session.id }),
      "ERR_SESSION_STATE_INVALID",
    );
  });

  test("an unknown session id is reported by a stable code", async () => {
    const { service } = harness({});
    await expectCode(service.getSession("nope"), "ERR_SESSION_NOT_FOUND");
  });
});

// ── 24-27. Concurrency and idempotency ───────────────────────────

describe("concurrency", () => {
  test("two concurrent answers produce exactly one accepted transition", async () => {
    const { service } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "run_workflow", workflowId: "design-to-code" },
      ],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    const outcomes = await Promise.allSettled([
      service.answerSession({ sessionId: result.session.id, answer: "a" }),
      service.answerSession({ sessionId: result.session.id, answer: "b" }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = rejected[0] as PromiseRejectedResult;
    expect(rejection.reason).toBeInstanceOf(DesignFlowError);
    expect((rejection.reason as DesignFlowError).code).toBe("ERR_SESSION_CONFLICT");
  });

  test("a duplicate answer cannot start two workflows", async () => {
    const { service, runner } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "run_workflow", workflowId: "design-to-code" },
      ],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    await service.answerSession({ sessionId: result.session.id, answer: "a" });
    // The session is now completed; a second submission must not be able to
    // start a second run, and is reported as a state error rather than
    // silently succeeding.
    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "a" }),
      "ERR_SESSION_NOT_WAITING",
    );

    expect(runner.started).toHaveLength(1);
  });

  test("a duplicate submission with the same idempotency key returns the first result", async () => {
    const { service } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "run_workflow", workflowId: "design-to-code" },
      ],
    });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });

    const [first, second] = await Promise.all([
      service.answerSession({
        sessionId: result.session.id,
        answer: "a",
        idempotencyKey: "key-1",
      }),
      service.answerSession({
        sessionId: result.session.id,
        answer: "a",
        idempotencyKey: "key-1",
      }),
    ]);

    expect(first.session.executionId).toBe(second.session.executionId);
  });
});

// ── 28-31. Turn limits ────────────────────────────────────────────

describe("turn limits", () => {
  test("exceeding the limit closes the session and starts no workflow", async () => {
    const questions = Array.from({ length: 5 }, (_, i) => ({
      type: "request_clarification" as const,
      question: `question ${i + 1}`,
    }));

    const { service, runner } = harness({ decisions: questions, maxClarificationTurns: 2 });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });
    expect(result.session.turnCount).toBe(1);

    const second = await service.answerSession({ sessionId: result.session.id, answer: "a" });
    expect(second.session.turnCount).toBe(2);

    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "b" }),
      "ERR_SESSION_TURN_LIMIT_EXCEEDED",
    );

    const closed = await service.getSession(result.session.id);
    expect(closed.status).toBe("failed");
    expect(runner.started).toHaveLength(0);
  });

  test("the limit is external — the agent's own decisions cannot raise it", async () => {
    // The agent asks for clarification forever; nothing about its decisions
    // configures the limit, and it is still enforced.
    const infinite = Array.from({ length: 20 }, () => ({
      type: "request_clarification" as const,
      question: "again?",
    }));

    const { service } = harness({ decisions: infinite, maxClarificationTurns: 1 });
    const result = await service.startSession({ workerId: "design-engineer", request: "help" });
    expect(result.session.status).toBe("waiting_for_user");

    await expectCode(
      service.answerSession({ sessionId: result.session.id, answer: "a" }),
      "ERR_SESSION_TURN_LIMIT_EXCEEDED",
    );
  });
});

// ── 33-37. Bounded context ────────────────────────────────────────

describe("resumed context", () => {
  test("the resumed task carries clarifications but no raw session object", async () => {
    const seenTasks: AgentTask[] = [];
    const { service } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "run_workflow", workflowId: "design-to-code" },
      ],
      seenTasks,
    });

    const started = await service.startSession({
      workerId: "design-engineer",
      request: "make it nicer",
    });
    await service.answerSession({ sessionId: started.session.id, answer: "the header" });

    const resumedTask = seenTasks[1];
    expect(resumedTask?.request).toBe("make it nicer");
    expect(resumedTask?.context).toEqual({
      clarifications: [{ question: "Which component?", answer: "the header" }],
    });

    // No trace id, turn count, status, or other session bookkeeping reached the task.
    const contextKeys = Object.keys(resumedTask?.context ?? {});
    expect(contextKeys).toEqual(["clarifications"]);
  });
});

// ── 38-41. Tracing ─────────────────────────────────────────────────

describe("session events", () => {
  test("safe session events are emitted without question or answer text", async () => {
    const events: SessionEvent[] = [];
    const observer: SessionObserver = {
      onEvent: async (event) => {
        events.push(event);
      },
    };

    const { service } = harness({
      decisions: [
        { type: "request_clarification", question: "Which component?" },
        { type: "run_workflow", workflowId: "design-to-code" },
      ],
      observer,
    });

    const started = await service.startSession({ workerId: "design-engineer", request: "help" });
    await service.answerSession({ sessionId: started.session.id, answer: "the header" });

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "session.created",
      "session.waiting_for_user",
      "session.answered",
      "session.resumed",
      "session.completed",
    ]);

    for (const event of events) {
      expect(JSON.stringify(event)).not.toContain("Which component");
      expect(JSON.stringify(event)).not.toContain("the header");
    }
  });

  test("an observer failure does not break the session or the workflow", async () => {
    const observer: SessionObserver = {
      onEvent: () => Promise.reject(new Error("observer down")),
    };

    const { service, runner } = harness({
      decisions: [{ type: "run_workflow", workflowId: "design-to-code" }],
      observer,
    });

    const result = await service.startSession({ workerId: "design-engineer", request: "help" });
    expect(result.session.status).toBe("completed");
    expect(runner.started).toHaveLength(1);
  });
});
