// packages/sdk/src/session.test.ts
import { describe, expect, test } from "bun:test";
import {
  agentSessionSchema,
  agentSessionPatchSchema,
  sessionAnswerSchema,
  sessionStatusSchema,
  sessionEventSchema,
  startSessionRequestSchema,
  answerSessionRequestSchema,
  cancelSessionRequestSchema,
  sessionListFilterSchema,
  isValidSessionTransition,
  isTerminalSessionStatus,
  selectSessions,
} from "./session";
import type { AgentSession } from "./session";

const SESSION: AgentSession = {
  id: "session-1",
  workerId: "design-engineer",
  agentId: "design-engineer-agent",
  status: "active",
  createdAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  version: 1,
  turnCount: 0,
  originalRequest: "make it nicer",
  answers: [],
  traceIds: [],
};

// ── 1. Session schema ────────────────────────────────────────────

describe("agentSessionSchema", () => {
  test("accepts a freshly started session", () => {
    const session = agentSessionSchema.parse(SESSION);
    expect(session.status).toBe("active");
    expect(session.answers).toEqual([]);
  });

  test("rejects an unknown status", () => {
    expect(() => agentSessionSchema.parse({ ...SESSION, status: "paused" })).toThrow();
  });

  test("rejects an unrecognised extra field", () => {
    expect(() => agentSessionSchema.parse({ ...SESSION, chainOfThought: "..." })).toThrow();
  });

  test("rejects answers whose turn numbers do not strictly increase", () => {
    expect(() =>
      agentSessionSchema.parse({
        ...SESSION,
        answers: [
          { turn: 1, question: "q1", answer: "a1", answeredAt: "2026-08-01T10:00:01.000Z" },
          { turn: 1, question: "q2", answer: "a2", answeredAt: "2026-08-01T10:00:02.000Z" },
        ],
      }),
    ).toThrow();
  });

  test("accepts strictly increasing answer turns", () => {
    const session = agentSessionSchema.parse({
      ...SESSION,
      turnCount: 2,
      answers: [
        { turn: 1, question: "q1", answer: "a1", answeredAt: "2026-08-01T10:00:01.000Z" },
        { turn: 2, question: "q2", answer: "a2", answeredAt: "2026-08-01T10:00:02.000Z" },
      ],
    });
    expect(session.answers).toHaveLength(2);
  });
});

describe("sessionAnswerSchema", () => {
  test("rejects an empty question or answer", () => {
    expect(() =>
      sessionAnswerSchema.parse({ turn: 1, question: "", answer: "a", answeredAt: "t" }),
    ).toThrow();
    expect(() =>
      sessionAnswerSchema.parse({ turn: 1, question: "q", answer: "", answeredAt: "t" }),
    ).toThrow();
  });

  test("rejects an answer past the bounded length", () => {
    expect(() =>
      sessionAnswerSchema.parse({
        turn: 1,
        question: "q",
        answer: "a".repeat(4_001),
        answeredAt: "t",
      }),
    ).toThrow();
  });
});

describe("agentSessionPatchSchema", () => {
  test("accepts a partial update", () => {
    const patch = agentSessionPatchSchema.parse({
      updatedAt: "2026-08-01T10:01:00.000Z",
      status: "waiting_for_user",
      currentQuestion: "Which component?",
    });
    expect(patch.status).toBe("waiting_for_user");
  });
});

// ── 2. State machine ─────────────────────────────────────────────

describe("isValidSessionTransition", () => {
  test("allows the documented transitions", () => {
    expect(isValidSessionTransition("active", "waiting_for_user")).toBe(true);
    expect(isValidSessionTransition("active", "completed")).toBe(true);
    expect(isValidSessionTransition("active", "declined")).toBe(true);
    expect(isValidSessionTransition("active", "failed")).toBe(true);
    expect(isValidSessionTransition("waiting_for_user", "active")).toBe(true);
    expect(isValidSessionTransition("waiting_for_user", "cancelled")).toBe(true);
  });

  test("refuses transitions out of a terminal status", () => {
    expect(isValidSessionTransition("completed", "active")).toBe(false);
    expect(isValidSessionTransition("cancelled", "active")).toBe(false);
    expect(isValidSessionTransition("declined", "waiting_for_user")).toBe(false);
    expect(isValidSessionTransition("failed", "completed")).toBe(false);
  });

  test("isTerminalSessionStatus matches the transition table", () => {
    expect(isTerminalSessionStatus("completed")).toBe(true);
    expect(isTerminalSessionStatus("declined")).toBe(true);
    expect(isTerminalSessionStatus("failed")).toBe(true);
    expect(isTerminalSessionStatus("cancelled")).toBe(true);
    expect(isTerminalSessionStatus("active")).toBe(false);
    expect(isTerminalSessionStatus("waiting_for_user")).toBe(false);
  });
});

describe("sessionStatusSchema", () => {
  test("enumerates exactly the six statuses", () => {
    expect(sessionStatusSchema.options).toEqual([
      "active",
      "waiting_for_user",
      "completed",
      "declined",
      "failed",
      "cancelled",
    ]);
  });
});

// ── 3. Product requests ──────────────────────────────────────────

describe("startSessionRequestSchema", () => {
  test("defaults an absent request to an empty string", () => {
    const request = startSessionRequestSchema.parse({ workerId: "design-engineer" });
    expect(request.request).toBe("");
  });
});

describe("answerSessionRequestSchema", () => {
  test("rejects an empty answer", () => {
    expect(() =>
      answerSessionRequestSchema.parse({ sessionId: "session-1", answer: "" }),
    ).toThrow();
  });

  test("accepts an optional idempotency key", () => {
    const request = answerSessionRequestSchema.parse({
      sessionId: "session-1",
      answer: "the header",
      idempotencyKey: "key-1",
    });
    expect(request.idempotencyKey).toBe("key-1");
  });
});

describe("cancelSessionRequestSchema", () => {
  test("accepts a bare session id", () => {
    const request = cancelSessionRequestSchema.parse({ sessionId: "session-1" });
    expect(request.reason).toBeUndefined();
  });
});

// ── 4. Filtering ──────────────────────────────────────────────────

describe("selectSessions", () => {
  const sessions: AgentSession[] = [
    { ...SESSION, id: "s1", status: "waiting_for_user", updatedAt: "2026-08-01T10:00:00.000Z" },
    { ...SESSION, id: "s2", status: "completed", updatedAt: "2026-08-01T11:00:00.000Z" },
    {
      ...SESSION,
      id: "s3",
      workerId: "qa-reviewer",
      status: "waiting_for_user",
      updatedAt: "2026-08-01T12:00:00.000Z",
    },
  ];

  test("filters by status, most recently updated first", () => {
    const result = selectSessions(sessions, { status: "waiting_for_user" });
    expect(result.map((s) => s.id)).toEqual(["s3", "s1"]);
  });

  test("filters by worker id", () => {
    const result = selectSessions(sessions, { workerId: "qa-reviewer" });
    expect(result.map((s) => s.id)).toEqual(["s3"]);
  });

  test("honours limit", () => {
    const result = selectSessions(sessions, { limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("s3");
  });
});

describe("sessionListFilterSchema", () => {
  test("rejects an unknown field", () => {
    expect(() => sessionListFilterSchema.parse({ agentId: "x" })).toThrow();
  });
});

// ── 5. Session events ─────────────────────────────────────────────

describe("sessionEventSchema", () => {
  test("accepts every documented event type", () => {
    const timestamp = "2026-08-01T10:00:00.000Z";

    for (const event of [
      { type: "session.created", sessionId: "s1", workerId: "w", agentId: "a", timestamp },
      { type: "session.waiting_for_user", sessionId: "s1", turn: 1, timestamp },
      { type: "session.answered", sessionId: "s1", turn: 1, timestamp },
      { type: "session.resumed", sessionId: "s1", turn: 2, timestamp },
      { type: "session.completed", sessionId: "s1", timestamp },
      { type: "session.declined", sessionId: "s1", timestamp },
      { type: "session.failed", sessionId: "s1", errorCode: "ERR_SESSION_TURN_LIMIT_EXCEEDED", timestamp },
      { type: "session.cancelled", sessionId: "s1", timestamp },
      { type: "session.expired", sessionId: "s1", timestamp },
    ]) {
      expect(() => sessionEventSchema.parse(event)).not.toThrow();
    }
  });

  test("has no field anywhere for question or answer text", () => {
    const shapes = sessionEventSchema.options.map((option) => Object.keys(option.shape));
    for (const keys of shapes) {
      expect(keys).not.toContain("question");
      expect(keys).not.toContain("answer");
      expect(keys).not.toContain("request");
    }
  });

  test("rejects an event carrying an extra field", () => {
    expect(() =>
      sessionEventSchema.parse({
        type: "session.answered",
        sessionId: "s1",
        turn: 1,
        timestamp: "t",
        answerText: "the header",
      }),
    ).toThrow();
  });
});
