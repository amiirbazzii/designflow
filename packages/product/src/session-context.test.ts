// packages/product/src/session-context.test.ts
import { describe, expect, test } from "bun:test";
import { buildSessionContext } from "./session-context";
import type { AgentSession } from "@designflow/sdk";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
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
    ...overrides,
  };
}

describe("buildSessionContext", () => {
  test("carries the original request and no clarifications for a fresh session", () => {
    const context = buildSessionContext(session());
    expect(context.originalRequest).toBe("make it nicer");
    expect(context.clarifications).toEqual([]);
  });

  test("carries clarifications in chronological order", () => {
    const context = buildSessionContext(
      session({
        answers: [
          { turn: 1, question: "Which component?", answer: "Header", answeredAt: "t1" },
          { turn: 2, question: "What color?", answer: "Blue", answeredAt: "t2" },
        ],
      }),
    );

    expect(context.clarifications).toEqual([
      { question: "Which component?", answer: "Header" },
      { question: "What color?", answer: "Blue" },
    ]);
  });

  test("summarises the original input deterministically, key order independent", () => {
    const a = buildSessionContext(session({ originalInput: { b: 2, a: 1 } }));
    const b = buildSessionContext(session({ originalInput: { a: 1, b: 2 } }));
    expect(a.inputSummary).toBe(b.inputSummary);
    expect(a.inputSummary).toBe('{"a":1,"b":2}');
  });

  test("omits inputSummary when there was no original input", () => {
    const context = buildSessionContext(session());
    expect(context.inputSummary).toBeUndefined();
  });

  test("drops the oldest clarifications first when the budget is exceeded", () => {
    const context = buildSessionContext(
      session({
        answers: [
          { turn: 1, question: "q1", answer: "a".repeat(50), answeredAt: "t1" },
          { turn: 2, question: "q2", answer: "b".repeat(50), answeredAt: "t2" },
          { turn: 3, question: "q3", answer: "c".repeat(50), answeredAt: "t3" },
        ],
      }),
      { maxClarificationChars: 120 },
    );

    // Each pair costs ~52 chars; only the two newest fit within 120.
    expect(context.clarifications.map((c) => c.question)).toEqual(["q2", "q3"]);
  });

  test("truncates a long input summary rather than exceeding the budget", () => {
    const context = buildSessionContext(
      session({ originalInput: { text: "x".repeat(2_000) } }),
      { maxInputSummaryChars: 50 },
    );

    expect(context.inputSummary?.length).toBe(51); // 50 chars + the ellipsis marker
  });

  test("is deterministic across repeated calls", () => {
    const built = session({
      answers: [{ turn: 1, question: "q", answer: "a", answeredAt: "t" }],
      originalInput: { foo: "bar" },
    });

    expect(buildSessionContext(built)).toEqual(buildSessionContext(built));
  });
});
