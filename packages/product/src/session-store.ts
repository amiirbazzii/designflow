// packages/product/src/session-store.ts
import {
  agentSessionPatchSchema,
  agentSessionSchema,
  applySessionPatch,
  selectSessions,
  type AgentSession,
  type AgentSessionPatch,
  type SessionListFilter,
  type SessionStore,
} from "@designflow/sdk";

import { SessionAlreadyExistsError, SessionConflictError, SessionNotFoundError } from "./session-errors";

/**
 * Where sessions live, for tests and embedding.
 *
 * The session-level analogue of `InMemoryTraceStore`: a plain `Map`, every
 * write validated against the SDK's `.strict()` schema, optimistic
 * concurrency enforced the same way `FileSessionStore` enforces it on disk —
 * so a test written against this store exercises the same conflict behaviour
 * a real install would hit.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, AgentSession>();

  public async create(session: AgentSession): Promise<void> {
    const validated = agentSessionSchema.parse(session);
    if (this.sessions.has(validated.id)) {
      throw new SessionAlreadyExistsError(validated.id);
    }

    this.sessions.set(validated.id, validated);
  }

  public async get(sessionId: string): Promise<AgentSession | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  public async update(
    sessionId: string,
    expectedVersion: number,
    patch: AgentSessionPatch,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing === undefined) throw new SessionNotFoundError(sessionId);

    if (existing.version !== expectedVersion) {
      throw new SessionConflictError(sessionId, expectedVersion, existing.version);
    }

    const validatedPatch = agentSessionPatchSchema.parse(patch);
    const updated = applySessionPatch(existing, validatedPatch, existing.version + 1);

    this.sessions.set(sessionId, updated);
    return updated;
  }

  public async list(filters?: SessionListFilter): Promise<readonly AgentSession[]> {
    return selectSessions([...this.sessions.values()], filters);
  }
}
