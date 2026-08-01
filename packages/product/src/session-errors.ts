// packages/product/src/session-errors.ts
import { DesignFlowError } from "@designflow/sdk";

/**
 * Session failures, each with a stable code.
 *
 * The same discipline `packages/agents/src/errors.ts` established for agent
 * failures, one layer up: a caller — the CLI's error table, a future HTTP
 * tier — decides what to do about a session failure by matching `code`, never
 * by reading English.
 *
 * Enumerated so the CLI's user-facing error table can be checked against it,
 * the same reason `AGENT_ERROR_CODES` is enumerated.
 */
export const SESSION_ERROR_CODES = [
  "ERR_SESSION_NOT_FOUND",
  "ERR_SESSION_ALREADY_EXISTS",
  "ERR_SESSION_INVALID",
  "ERR_SESSION_STATE_INVALID",
  "ERR_SESSION_NOT_WAITING",
  "ERR_SESSION_EXPIRED",
  "ERR_SESSION_TURN_LIMIT_EXCEEDED",
  "ERR_SESSION_ANSWER_INVALID",
  "ERR_SESSION_CANCELLED",
  "ERR_SESSION_STORE_FAILED",
  "ERR_SESSION_CONFLICT",
] as const;

export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number];

/** No session exists under that id. Shares its code with the store's own not-found error. */
export class SessionNotFoundError extends DesignFlowError {
  public constructor(sessionId: string) {
    super("ERR_SESSION_NOT_FOUND", `No such session: ${sessionId}`, { sessionId });
    this.name = "SessionNotFoundError";
    Object.setPrototypeOf(this, SessionNotFoundError.prototype);
  }
}

/** A caller tried to create a session under an id already in use. */
export class SessionAlreadyExistsError extends DesignFlowError {
  public constructor(sessionId: string) {
    super("ERR_SESSION_ALREADY_EXISTS", `A session already exists: ${sessionId}`, {
      sessionId,
    });
    this.name = "SessionAlreadyExistsError";
    Object.setPrototypeOf(this, SessionAlreadyExistsError.prototype);
  }
}

/** An update named a version older than the one currently stored. */
export class SessionConflictError extends DesignFlowError {
  public constructor(sessionId: string, expectedVersion: number, actualVersion: number) {
    super(
      "ERR_SESSION_CONFLICT",
      `Session ${sessionId} is at version ${actualVersion}, not ${expectedVersion}`,
      { sessionId, expectedVersion, actualVersion },
    );
    this.name = "SessionConflictError";
    Object.setPrototypeOf(this, SessionConflictError.prototype);
  }
}

/** A request did not match its schema — a malformed `StartSessionRequest`, answer, or the like. */
export class SessionInvalidError extends DesignFlowError {
  public constructor(issues: readonly string[]) {
    super("ERR_SESSION_INVALID", `Invalid session request: ${issues.join("; ")}`, {
      issues: [...issues],
    });
    this.name = "SessionInvalidError";
    Object.setPrototypeOf(this, SessionInvalidError.prototype);
  }
}

/** A transition the state machine does not allow — e.g. cancelling a session that already completed. */
export class SessionStateInvalidError extends DesignFlowError {
  public constructor(sessionId: string, from: string, to: string) {
    super(
      "ERR_SESSION_STATE_INVALID",
      `Session ${sessionId} cannot move from ${from} to ${to}`,
      { sessionId, from, to },
    );
    this.name = "SessionStateInvalidError";
    Object.setPrototypeOf(this, SessionStateInvalidError.prototype);
  }
}

/** An answer arrived for a session that is not currently waiting for one. */
export class SessionNotWaitingError extends DesignFlowError {
  public constructor(sessionId: string, status: string) {
    super(
      "ERR_SESSION_NOT_WAITING",
      `Session ${sessionId} is not waiting for an answer (status: ${status})`,
      { sessionId, status },
    );
    this.name = "SessionNotWaitingError";
    Object.setPrototypeOf(this, SessionNotWaitingError.prototype);
  }
}

/** The session's `expiresAt` has passed. Evaluated against the injected clock, never the wall clock directly. */
export class SessionExpiredError extends DesignFlowError {
  public constructor(sessionId: string) {
    super("ERR_SESSION_EXPIRED", `Session ${sessionId} has expired`, { sessionId });
    this.name = "SessionExpiredError";
    Object.setPrototypeOf(this, SessionExpiredError.prototype);
  }
}

/**
 * The session asked for more clarification than the externally enforced limit allows.
 *
 * Raised after the session has already been closed as `failed` — the limit is
 * not something an agent can negotiate around, the same way a tool or model
 * call budget is enforced outside agent cooperation.
 */
export class SessionTurnLimitExceededError extends DesignFlowError {
  public constructor(sessionId: string, limit: number) {
    super(
      "ERR_SESSION_TURN_LIMIT_EXCEEDED",
      `Session ${sessionId} reached its clarification limit (${limit} turns)`,
      { sessionId, limit },
    );
    this.name = "SessionTurnLimitExceededError";
    Object.setPrototypeOf(this, SessionTurnLimitExceededError.prototype);
  }
}

/** An answer could not be recorded — an internal patch failed validation. */
export class SessionAnswerInvalidError extends DesignFlowError {
  public constructor(sessionId: string, detail: string) {
    super("ERR_SESSION_ANSWER_INVALID", `Session ${sessionId} rejected that answer: ${detail}`, {
      sessionId,
    });
    this.name = "SessionAnswerInvalidError";
    Object.setPrototypeOf(this, SessionAnswerInvalidError.prototype);
  }
}

/** The session was already cancelled, so it cannot be answered or resumed. */
export class SessionCancelledError extends DesignFlowError {
  public constructor(sessionId: string) {
    super("ERR_SESSION_CANCELLED", `Session ${sessionId} was cancelled`, { sessionId });
    this.name = "SessionCancelledError";
    Object.setPrototypeOf(this, SessionCancelledError.prototype);
  }
}

/** The store rejected a read or write for a reason this layer does not otherwise recognise. */
export class SessionStoreFailedError extends DesignFlowError {
  public constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super("ERR_SESSION_STORE_FAILED", `Session storage failed: ${detail}`, {});
    this.name = "SessionStoreFailedError";
    Object.setPrototypeOf(this, SessionStoreFailedError.prototype);
  }
}
