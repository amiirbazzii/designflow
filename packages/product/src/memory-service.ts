// packages/product/src/memory-service.ts
import {
  NOOP_MEMORY_OBSERVER,
  agentMemorySchema,
  memoryProposalSchema,
  type AgentMemory,
  type AgentMemoryStore,
  type MemoryEvent,
  type MemoryListFilter,
  type MemoryObserver,
  type MemoryProposal,
  type MemoryProposalListFilter,
  type MemoryProposalStore,
  type MemoryScope,
} from "@designflow/sdk";

import { MemoryApprovalRequiredError, MemoryProposalExpiredError } from "./memory-errors";

/**
 * Input for `AgentMemoryService.addMemory` — everything an `AgentMemory`
 * needs except `id`/`createdAt`/`updatedAt`/`status`, which this service
 * stamps.
 */
export interface AddMemoryInput {
  readonly scope: MemoryScope;
  readonly agentId?: string;
  readonly projectId?: string;
  readonly key: string;
  readonly value: unknown;
  readonly source: AgentMemory["source"];
  readonly expiresAt?: string;
}

export interface AgentMemoryServiceOptions {
  readonly store: AgentMemoryStore;
  readonly observer?: MemoryObserver | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
}

/**
 * The product surface over `AgentMemoryStore`.
 *
 * `addMemory` is the *only* way durable memory is created directly — a person
 * authoring it through `designflow memory add`, or `MemoryProposalService`
 * approving a proposal. An agent never reaches this class; see the module
 * docstring on `MemoryProposalService` for why that boundary is architectural,
 * not just a convention.
 *
 * A duplicate key within the same exact scope is handled explicitly rather
 * than silently accumulating: the previous active memory for that
 * scope+key is revoked before the new one is created, so `list({status:
 * "active"})` never returns two records answering the same question.
 */
export class AgentMemoryService {
  private readonly store: AgentMemoryStore;
  private readonly observer: MemoryObserver;
  private readonly generateId: () => string;
  private readonly now: () => string;

  public constructor(options: AgentMemoryServiceOptions) {
    this.store = options.store;
    this.observer = options.observer ?? NOOP_MEMORY_OBSERVER;
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async addMemory(input: AddMemoryInput): Promise<AgentMemory> {
    await this.revokeExisting(input.scope, input.agentId, input.projectId, input.key);

    const now = this.now();
    const memory = agentMemorySchema.parse({
      id: this.generateId(),
      scope: input.scope,
      ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      key: input.key,
      value: input.value,
      source: input.source,
      createdAt: now,
      updatedAt: now,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      status: "active",
    });

    await this.store.create(memory);
    await this.emit({ type: "memory.approved", memoryId: memory.id, scope: memory.scope, timestamp: now });

    return memory;
  }

  public async listMemory(filters?: MemoryListFilter): Promise<readonly AgentMemory[]> {
    return this.store.list(filters);
  }

  public async revokeMemory(id: string): Promise<AgentMemory> {
    const revoked = await this.store.revoke(id, this.now());
    await this.emit({
      type: "memory.revoked",
      memoryId: revoked.id,
      scope: revoked.scope,
      timestamp: this.now(),
    });
    return revoked;
  }

  private async revokeExisting(
    scope: MemoryScope,
    agentId: string | undefined,
    projectId: string | undefined,
    key: string,
  ): Promise<void> {
    const existing = await this.store.list({
      scope,
      ...(agentId !== undefined ? { agentId } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
      key,
      status: "active",
    });

    for (const memory of existing) {
      await this.store.revoke(memory.id, this.now());
    }
  }

  private async emit(event: MemoryEvent): Promise<void> {
    try {
      await this.observer.onEvent(event);
    } catch {
      // Observing must never break the memory operation it observes.
    }
  }
}

// ── Memory proposals ────────────────────────────────────────────

export interface ProposeMemoryInput {
  readonly proposedByAgentId: string;
  readonly scope: MemoryScope;
  readonly projectId?: string;
  readonly key: string;
  readonly value: unknown;
  readonly rationaleSummary: string;
}

export interface MemoryProposalServiceOptions {
  readonly store: MemoryProposalStore;
  readonly memory: AgentMemoryService;
  readonly observer?: MemoryObserver | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly now?: (() => string) | undefined;
  readonly expirationDays?: number | undefined;
}

const DEFAULT_PROPOSAL_EXPIRATION_DAYS = 30;

/**
 * The approval boundary between what an agent may suggest and what becomes
 * durable memory.
 *
 * `propose` is the *only* thing an agent-facing surface may call — it never
 * creates memory, only a `pending` proposal. `approve`/`reject` are called
 * exclusively from a product surface a person drives (the CLI's `memory
 * approve`/`memory reject` commands); nothing here hands an agent a reference
 * to this service, which is the actual enforcement — `approvedBy ===
 * proposedByAgentId` is checked anyway, as defense in depth, but the
 * structural fact that an `Agent.decide` call never receives this class is
 * what makes "an agent cannot approve its own memory" true rather than merely
 * documented.
 */
export class MemoryProposalService {
  private readonly store: MemoryProposalStore;
  private readonly memory: AgentMemoryService;
  private readonly observer: MemoryObserver;
  private readonly generateId: () => string;
  private readonly now: () => string;
  private readonly expirationDays: number;

  public constructor(options: MemoryProposalServiceOptions) {
    this.store = options.store;
    this.memory = options.memory;
    this.observer = options.observer ?? NOOP_MEMORY_OBSERVER;
    this.generateId = options.generateId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.expirationDays = options.expirationDays ?? DEFAULT_PROPOSAL_EXPIRATION_DAYS;
  }

  public async propose(input: ProposeMemoryInput): Promise<MemoryProposal> {
    const now = this.now();

    const proposal = memoryProposalSchema.parse({
      id: this.generateId(),
      proposedByAgentId: input.proposedByAgentId,
      scope: input.scope,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      key: input.key,
      value: input.value,
      rationaleSummary: input.rationaleSummary,
      createdAt: now,
      expiresAt: addDays(now, this.expirationDays),
      status: "pending",
    });

    await this.store.create(proposal);
    await this.emit({
      type: "memory.proposed",
      proposalId: proposal.id,
      scope: proposal.scope,
      agentId: proposal.proposedByAgentId,
      timestamp: now,
    });

    return proposal;
  }

  public async getProposal(id: string): Promise<MemoryProposal | null> {
    return this.store.get(id);
  }

  public async listProposals(filters?: MemoryProposalListFilter): Promise<readonly MemoryProposal[]> {
    return this.store.list(filters);
  }

  public async approve(id: string, approvedBy: string): Promise<AgentMemory> {
    await this.checkResolvable(id, approvedBy);

    const now = this.now();
    const resolved = await this.store.approve(id, approvedBy, now);

    const memory = await this.memory.addMemory({
      scope: resolved.scope,
      ...(resolved.scope !== "project" ? { agentId: resolved.proposedByAgentId } : {}),
      ...(resolved.projectId !== undefined ? { projectId: resolved.projectId } : {}),
      key: resolved.key,
      value: resolved.value,
      source: "user_approved",
    });

    await this.emit({
      type: "memory.approved",
      proposalId: resolved.id,
      memoryId: memory.id,
      scope: memory.scope,
      timestamp: now,
    });

    return memory;
  }

  public async reject(id: string, resolvedBy: string): Promise<MemoryProposal> {
    await this.checkExpiry(id);

    const now = this.now();
    const rejected = await this.store.reject(id, resolvedBy, now);

    await this.emit({ type: "memory.rejected", proposalId: rejected.id, timestamp: now });

    return rejected;
  }

  /**
   * Checks the two things `store.approve`/`store.reject` cannot see on their
   * own: whether the approver is the proposing agent, and whether a still-
   * `pending` proposal has already passed its `expiresAt`. A missing proposal
   * or one already resolved is left entirely to the store call that follows,
   * which already carries the right `NOT_FOUND`/`STATE_INVALID` codes.
   */
  private async checkResolvable(id: string, approvedBy: string): Promise<void> {
    const proposal = await this.store.get(id);
    if (proposal === null) return;

    if (proposal.proposedByAgentId === approvedBy) {
      throw new MemoryApprovalRequiredError(id);
    }

    await this.checkExpiry(id, proposal);
  }

  private async checkExpiry(id: string, loaded?: MemoryProposal | null): Promise<void> {
    const proposal = loaded !== undefined ? loaded : await this.store.get(id);
    if (proposal === null || proposal === undefined) return;

    if (proposal.status === "pending" && proposal.expiresAt <= this.now()) {
      throw new MemoryProposalExpiredError(id);
    }
  }

  private async emit(event: MemoryEvent): Promise<void> {
    try {
      await this.observer.onEvent(event);
    } catch {
      // Observing must never break the proposal operation it observes.
    }
  }
}

/** UTC, so a proposal created near midnight expires the same number of whole days later everywhere. */
function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}
