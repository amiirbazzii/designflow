// packages/product/src/session-context.ts
import type { AgentSession } from "@designflow/sdk";

/**
 * Turns a stored session into what a resumed decision is allowed to see.
 *
 * `AgentSession` is a stored record — it type-checks against the SDK's
 * `.strict()` schema, but nothing stops a caller who holds the whole object
 * from handing it straight to a model. This is the one function that is
 * supposed to be called instead: it reads a session and returns a small,
 * bounded, JSON-serialisable value built for exactly one purpose — resuming
 * the conversation — with no field that isn't the original request, the
 * original input, or a clarification question/answer pair.
 *
 * What it deliberately does not carry, because the session it reads does not
 * either: trace ids, the execution id, the model profile snapshot, turn
 * counters, timestamps, status. All of that is bookkeeping for the Session
 * Orchestrator, not material for the agent's next decision.
 */

export interface SessionContextClarification {
  readonly question: string;
  readonly answer: string;
}

export interface SessionContext {
  readonly originalRequest: string;
  /** A bounded, deterministic rendering of the original structured input, when there was one. */
  readonly inputSummary?: string;
  /**
   * Oldest first, chronological — the order a person actually answered them
   * in — even though truncation (see `buildSessionContext`) decides which
   * ones survive by walking newest first.
   */
  readonly clarifications: readonly SessionContextClarification[];
}

export interface SessionContextOptions {
  /** Total character budget across every clarification's question + answer text. */
  readonly maxClarificationChars?: number;
  /** Character budget for `inputSummary`. */
  readonly maxInputSummaryChars?: number;
}

const DEFAULT_MAX_CLARIFICATION_CHARS = 4_000;
const DEFAULT_MAX_INPUT_SUMMARY_CHARS = 1_000;

/**
 * Deterministic. No clock, no randomness — the same session and the same
 * options produce byte-identical output every time, which is what lets a
 * resumed decision be reasoned about and tested like any other bounded input.
 *
 * Truncation strategy, when the clarification budget would be exceeded: walk
 * the answers newest first, keep adding whole question/answer pairs while
 * they fit, and stop at the first one that doesn't. The newest answers are
 * the ones most likely to still be relevant to what the agent is about to
 * decide, so they are the ones kept; older exchanges are dropped whole,
 * never truncated mid-pair, so what remains is always a complete question and
 * a complete answer.
 */
export function buildSessionContext(
  session: AgentSession,
  options?: SessionContextOptions,
): SessionContext {
  const maxClarificationChars =
    options?.maxClarificationChars ?? DEFAULT_MAX_CLARIFICATION_CHARS;
  const maxInputSummaryChars = options?.maxInputSummaryChars ?? DEFAULT_MAX_INPUT_SUMMARY_CHARS;

  const newestFirst = [...session.answers].sort((left, right) => right.turn - left.turn);

  const kept: SessionContextClarification[] = [];
  let used = 0;

  for (const answer of newestFirst) {
    const size = answer.question.length + answer.answer.length;
    if (used + size > maxClarificationChars) break;

    kept.push({ question: answer.question, answer: answer.answer });
    used += size;
  }

  // Restore chronological order now that the newest-first walk has decided
  // which pairs survive.
  const clarifications = kept.reverse();

  const inputSummary =
    session.originalInput === undefined
      ? undefined
      : summarizeInput(session.originalInput, maxInputSummaryChars);

  return {
    originalRequest: session.originalRequest,
    ...(inputSummary !== undefined ? { inputSummary } : {}),
    clarifications,
  };
}

/** A stable, order-independent rendering — the same input always summarises the same way. */
function summarizeInput(input: unknown, maxChars: number): string {
  const serialized = JSON.stringify(canonicalize(input));
  const text = serialized ?? "null";

  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    return items.map(canonicalize);
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const ordered: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      ordered[key] = canonicalize(record[key]);
    }
    return ordered;
  }

  return value;
}
