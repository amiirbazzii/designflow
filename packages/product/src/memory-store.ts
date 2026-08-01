// packages/product/src/memory-store.ts
import {
  agentMemorySchema,
  selectMemory,
  type AgentMemory,
  type AgentMemoryStore,
  type MemoryListFilter,
} from "@designflow/sdk";

import { MemoryAlreadyExistsError, MemoryNotFoundError } from "./memory-errors";

/** Where memory lives, for tests and embedding. Same shape as `InMemorySessionStore`. */
export class InMemoryAgentMemoryStore implements AgentMemoryStore {
  private readonly memories = new Map<string, AgentMemory>();

  public async create(memory: AgentMemory): Promise<void> {
    const validated = agentMemorySchema.parse(memory);
    if (this.memories.has(validated.id)) throw new MemoryAlreadyExistsError(validated.id);

    this.memories.set(validated.id, validated);
  }

  public async get(id: string): Promise<AgentMemory | null> {
    return this.memories.get(id) ?? null;
  }

  public async list(filters?: MemoryListFilter): Promise<readonly AgentMemory[]> {
    return selectMemory([...this.memories.values()], filters);
  }

  public async update(
    id: string,
    patch: { value?: unknown; expiresAt?: string; updatedAt: string },
  ): Promise<AgentMemory> {
    const existing = this.memories.get(id);
    if (existing === undefined) throw new MemoryNotFoundError(id);

    const updated = agentMemorySchema.parse({
      ...existing,
      ...(patch.value !== undefined ? { value: patch.value } : {}),
      ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}),
      updatedAt: patch.updatedAt,
    });

    this.memories.set(id, updated);
    return updated;
  }

  public async revoke(id: string, updatedAt: string): Promise<AgentMemory> {
    const existing = this.memories.get(id);
    if (existing === undefined) throw new MemoryNotFoundError(id);

    const updated = agentMemorySchema.parse({ ...existing, status: "revoked", updatedAt });
    this.memories.set(id, updated);
    return updated;
  }
}
